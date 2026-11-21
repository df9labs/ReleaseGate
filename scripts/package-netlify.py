"""Build the public Netlify upload and private Ubuntu handover from tracked distribution files."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'deploy'
BUILD_FILES = {
    '.dockerignore', 'Dockerfile', 'index.html', 'package.json', 'package-lock.json',
    'postcss.config.cjs', 'tailwind.config.cjs', 'tsconfig.json', 'vite.config.ts',
}


def tracked_files():
    listing = subprocess.check_output(
        ['git', '-c', f'safe.directory={ROOT.as_posix()}', 'ls-files', '-z'], cwd=ROOT,
    )
    return [Path(name.decode('utf-8')) for name in listing.split(b'\0') if name]


def copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() in {'.md', '.ts', '.tsx', '.css', '.json', '.sql', '.sh', '.yaml', '.cjs',
                                 '.html', '.example', '.svg', '.txt'} or source.suffix == '':
        destination.write_bytes(source.read_bytes().replace(b'\r\n', b'\n'))
    else:
        shutil.copyfile(source, destination)


def write_zip(directory, target):
    temporary = target.with_suffix('.zip.tmp')
    try:
        with ZipFile(temporary, 'w', compression=ZIP_DEFLATED) as archive:
            for path in sorted(directory.rglob('*')):
                if path.is_file():
                    entry = ZipInfo(path.relative_to(directory).as_posix())
                    entry.create_system = 3
                    entry.external_attr = (0o100755 if path.name == 'setup.sh' else 0o100644) << 16
                    archive.writestr(entry, path.read_bytes(), compress_type=ZIP_DEFLATED)
        with ZipFile(temporary) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('Archive integrity check failed.')
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    work = ROOT / '.work'
    work.mkdir(exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='netlify-package-', dir=work) as staging:
        kit = Path(staging)
        ubuntu = kit / 'ubuntu'
        site = kit / 'netlify-site'
        for path in tracked_files():
            name = path.as_posix()
            if name.startswith('deploy/ubuntu/'):
                copy(ROOT / path, ubuntu / path.relative_to('deploy/ubuntu'))
            elif name in BUILD_FILES or (
                (name.startswith(('server/', 'src/')) and path.suffix in {'.ts', '.tsx', '.css', '.sql'})
                or (name.startswith('public/') and path.suffix in {'.woff2', '.png', '.svg', '.txt', '.json'})
            ):
                copy(ROOT / path, ubuntu / path)
        for required in ('README.md', 'compose.yaml', 'setup.sh', '.env.example', 'server/hosting-jobs.ts',
                         'src/netlify-jobs.ts', 'server/migrations/9000_hosted_settings.sql', 'server/seed/README.md'):
            if not (ubuntu / required).is_file():
                raise RuntimeError(f'Missing distribution input: {required}')
        # Build away from the working installation and its .env, using the locked local toolchain.
        frontend_env = {key: value for key, value in os.environ.items() if not key.upper().startswith('VITE_')}
        subprocess.run(['node', str(ROOT / 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'netlify',
                        '--outDir', str(site)], cwd=ubuntu, env=frontend_env, check=True)
        for filename in ('_redirects', '_headers'):
            copy(ROOT / 'deploy/netlify' / filename, site / filename)
        copy(ROOT / 'deploy/START-HERE.md', kit / 'START-HERE.md')
        heading = '## Limits and where to change them'
        limits = (ROOT / 'README.md').read_text(encoding='utf-8').split(heading, 1)[1].split('\n## ', 1)[0]
        (ubuntu / 'RUNTIME-LIMITS.md').write_text('# Runtime limits' + limits.rstrip() + '\n', encoding='utf-8', newline='\n')
        admin_tool = ubuntu / 'apply-admin-password.mjs'
        subprocess.run(['node', '--input-type=module', '-e',
                        "import { build } from 'esbuild'; await build({ entryPoints:['scripts/hosted-admin-password.ts'], "
                        "bundle:true, platform:'node', format:'esm', target:'node24', outfile:process.argv[1] });",
                        str(admin_tool)], cwd=ROOT, check=True)
        # Vite may create build caches below the working directory. Never distribute installed modules.
        cache = ubuntu / 'node_modules'
        if cache.is_dir():
            shutil.rmtree(cache)
        for file in kit.rglob('*'):
            if file.is_file() and (file.name == '.env' or file.suffix in {'.map', '.sqlite', '.pdf'}
                                   or file.name == 'demo.json' or 'node_modules' in file.parts):
                raise RuntimeError(f'Unexpected distribution file: {file.relative_to(kit)}')
        write_zip(site, OUT / 'ReleaseGate-Netlify.zip')
        write_zip(kit, OUT / 'ReleaseGate-Deployment.zip')
        shutil.copyfile(admin_tool, OUT / admin_tool.name)
    print(f'Wrote the Netlify ZIP, deployment kit and standalone admin password tool to {OUT}')


if __name__ == '__main__':
    main()
