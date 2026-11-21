import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 24 || (major === 24 && minor < 14)) {
  console.error('ReleaseGate requires Node.js 24.14 or later.');
  process.exit(1);
}
function npm(args) {
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
  const commandArgs = process.platform === 'win32' ? ['/d', '/c', 'npm.cmd', ...args] : args;
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: { ...process.env, npm_config_cache: '.work/npm-cache' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
let configuration = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8');
const values = { ...parseEnv(configuration), ...process.env };
if (!values.DEMO_ADMIN_PASSWORD && values.NODE_ENV !== 'production') {
  const generated = randomBytes(24).toString('base64url');
  configuration =
    configuration.replace(/^DEMO_ADMIN_PASSWORD=.*$/gm, '').trimEnd() +
    '\nDEMO_ADMIN_PASSWORD=' +
    generated +
    '\n';
}
if (!existsSync('.env') || readFileSync('.env', 'utf8') !== configuration)
  writeFileSync('.env', configuration, { mode: 0o600 });
const lock = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
const marker = 'node_modules/.releasegate-lock';
if (
  !existsSync(marker) ||
  readFileSync(marker, 'utf8') !== lock ||
  !existsSync('node_modules/vite/package.json')
) {
  npm(['ci', '--no-audit', '--no-fund']);
  writeFileSync(marker, lock);
}
npm(['run', 'build']);
console.log('Demo sign-in details are in the local .env file.');
npm(['start']);
