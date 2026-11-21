/**
 * Offline release audit. Report paths, detector names and counts only.
 * npm dependencies are checked through the lockfile and the installed production packages.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let currentPath = '';
const retired = 'base44';
const fields = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'clientsecret',
  'secretkey',
  'awssecretaccesskey',
  'apikey',
  'llmapikey',
  'demoadminpassword',
  'df9intakekey',
  'df9intakekeys',
  'xapikey',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'jwt',
  'authorization',
  'cookie',
  'setcookie',
  'privatekey',
]);
const knownSignatures = {
  'typed-provider-key':
    /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[A-Za-z0-9_-]{35}|xox[bpars]-[A-Za-z0-9-]{16,})\b/g,
  'private-key-block':
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]{32,}?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
  'signed-token': /\beyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{8,}\b/g,
};
const extensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.json',
  '.jsonl',
  '.md',
  '.txt',
  '.html',
  '.xml',
  '.yml',
  '.yaml',
  '.svg',
  '.ps1',
  '.py',
  '.cmd',
  '.sh',
  '.sql',
  '.env',
  '.example',
]);
const binaryMedia = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.mp4',
  '.webm',
  '.woff2',
  '.woff',
  '.ico',
  '.wasm',
  '.node',
  '.dll',
  '.exe',
]);
const normalPath = (s) => s.replaceAll('\\', '/');
const relative = (f) => normalPath(path.relative(root, f));
const isField = (key) => fields.has(key.toLowerCase().replaceAll(/[_\s-]/g, ''));
const placeholder =
  /^(?:\*+|\.{3,}|••+|\[.*?\]|<.*?>|\{.*?\}|true|false|null|undefined|none|empty|string|boolean|number|object|password|text|email|token|cookie|authorization|bearer|basic|optional|required|unset|change-me|redacted|omit(?:ted)?)$/i;

function literal(value) {
  return (
    typeof value === 'string' &&
    value.trim().length >= 6 &&
    !placeholder.test(value.trim()) &&
    !/^(?:(?:window\.|process\.env\.|import\.meta\.env\.|[ab-z]\.)|\$[{(]|-----BEGIN PUBLIC KEY)/i.test(
      value,
    ) &&
    !value.includes('[redacted]') &&
    !value.includes('[credential removed]')
  );
}

function detections(text, isData, packageManifest = false) {
  const counts = {};
  const add = (name) => {
    counts[name] = (counts[name] || 0) + 1;
  };
  for (const [name, pattern] of Object.entries(knownSignatures)) {
    for (const ignored of text.matchAll(pattern)) add(name);
  }
  for (const m of text.matchAll(
    /\bAuthorization\s*[:=]\s*["']?(?:Bearer|Basic)\s+([A-Za-z0-9+/_=.-]{8,})/gi,
  )) {
    if (literal(m[1])) add('literal-auth-header');
  }
  for (const m of text.matchAll(
    /(?:[?&]|&amp;)(?:access_token|refresh_token|api_key|x-amz-signature|id_token|client_secret)=([^&#'"\s<>]+)/gi,
  )) {
    if (literal(m[1])) add('credential-query-value');
  }
  for (const m of text.matchAll(/https?:\/\/([^/\s:@]+):([^/@\s]+)@/gi)) {
    if (m[1] && m[2] && !/[[\]{}$*]/.test(m[1] + m[2])) add('inline-url-credentials');
  }
  if (isData) {
    function inspect(data, parentKey = '') {
      if (Array.isArray(data)) {
        data.forEach((entry) => inspect(entry, parentKey));
        return;
      }
      if (!data || typeof data !== 'object') return;
      for (const [key, value] of Object.entries(data)) {
        if (isField(key) && literal(value)) {
          const packageVersion =
            packageManifest &&
            key === 'cookie' &&
            ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].includes(
              parentKey,
            ) &&
            /^[~^]?[\d.]+$/.test(value);
          add(packageVersion ? 'package-version-named-cookie' : 'literal-credential-field');
        } else if (value && typeof value === 'object') inspect(value, key);
      }
    }
    try {
      inspect(JSON.parse(text));
    } catch {
      for (const line of text.split('\n')) {
        try {
          inspect(JSON.parse(line));
        } catch {
          /* non-JSON evidence */
        }
      }
    }
  } else {
    for (const m of text.matchAll(
      /(?:^|[,{])\s*["']?(password|client[_-]?secret|api[_-]?key|llm[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|authorization|aws[_-]?secret[_-]?access[_-]?key)["']?\s*:\s*(['"])([^'"\r\n]+)\2/gim,
    )) {
      if (literal(m[3])) add('quoted-credential-field');
    }
    for (const m of text.matchAll(
      /^[\t ]*(?:LLM_API_KEY|INJECTION_API_KEY|DF9_INTAKE_KEYS?|DEMO_ADMIN_PASSWORD|API_KEY|CLIENT_SECRET|SESSION_SECRET|AWS_SECRET_ACCESS_KEY)[\t ]*=[\t ]*["']?([^#\s'"]+)/gim,
    )) {
      if (literal(m[1])) add('literal-env-value');
    }
  }
  return counts;
}

function scope(file) {
  if (file.startsWith('capture/')) return 'referenceEvidence';
  if (file.startsWith('parity/')) return 'parityEvidence';
  if (file.startsWith('docs/') || /^(?:README|PARITY_CHECKLIST)\.md$/.test(file)) return 'documentation';
  if (file.startsWith('dist/')) return 'builtOutput';
  if (file.startsWith('node_modules/')) return 'installedProductionDependencies';
  if (file === 'package.json' || file === 'package-lock.json') return 'dependencyManifests';
  if (file.startsWith('tests/')) return 'tests';
  if (
    /^(?:src|server|public|migrations)\//.test(file) ||
    ['Dockerfile', 'index.html', 'run.cmd', 'scripts/start-local.mjs', '.env.example'].includes(file)
  )
    return 'ownedRuntime';
  return 'developmentFiles';
}

async function* files(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === 'node_modules' || entry.name === '.git') continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(target);
    else if (entry.isFile()) yield target;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const inspectOcr = argv.includes('--ocr-stdin');
  if (inspectOcr) {
    const { createInterface } = await import('node:readline');
    const audits = [];
    for await (const line of createInterface({ input: process.stdin })) {
      try {
        const item = JSON.parse(line);
        audits.push({ path: item.path, counts: detections(item.text || '', false), status: item.status });
      } catch {
        throw new Error('The OCR stream contains an invalid record.');
      }
    }
    process.stdout.write(JSON.stringify(audits));
    return;
  }
  const outputIndex = argv.indexOf('--json');
  const output = outputIndex === -1 ? null : argv[outputIndex + 1];
  if (outputIndex !== -1 && !output) throw new Error('Supply a path after --json.');
  const git = ['-c', 'safe.directory=' + normalPath(root), '-C', root];
  const names = execFileSync(
    'git',
    [...git, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
    .split('\0')
    .filter(Boolean);
  const targets = new Set(names);
  for (const file of ['dist/client/index.html', 'dist/server/index.js']) {
    currentPath = file;
    await stat(path.join(root, file));
  }
  for await (const f of files(path.join(root, 'dist'))) targets.add(relative(f));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  let packageCount = 0;
  for (const [dir, entry] of Object.entries(lock.packages || {})) {
    if (!dir.startsWith('node_modules/') || entry.dev) continue;
    try {
      await stat(path.join(root, dir, 'package.json'));
    } catch {
      continue;
    }
    packageCount++;
    for await (const f of files(path.join(root, dir))) targets.add(relative(f));
  }
  for (const dependency of Object.keys(lock.packages[''].dependencies || {})) {
    currentPath = 'node_modules/' + dependency + '/package.json';
    await stat(path.join(root, currentPath));
  }
  const report = {
    groups: {},
    retiredPaths: [],
    credentialCandidates: [],
    runtimeOrigins: {},
    installedProductionPackageCount: packageCount,
    archivedFiles: 0,
    missingFiles: [],
    contentDigest: '',
  };
  const corpus = createHash('sha256');
  let failure = false;
  for (const file of [...targets].sort()) {
    currentPath = file;
    if (
      path.basename(file) === '.env' ||
      (path.basename(file).startsWith('.env.') && path.basename(file) !== '.env.example')
    )
      continue;
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(root + path.sep))
      throw new Error('The audit discovered a path outside its repository.');
    if (output && absolute === path.resolve(output)) continue;
    let bytes;
    try {
      bytes = await readFile(absolute);
    } catch (e) {
      if (e.code === 'ENOENT') {
        report.missingFiles.push(file);
        continue;
      }
      throw e;
    }
    const group = scope(file);
    const row = (report.groups[group] ??= {
      files: 0,
      retiredTextHits: 0,
      retiredNameHits: 0,
      credentialCandidateOccurrences: 0,
    });
    row.files++;
    const originalName = file.endsWith('.gz') ? file.slice(0, -3) : file;
    if (file.endsWith('.gz') && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = gunzipSync(bytes);
      report.archivedFiles++;
    } else if (file.startsWith('capture/') && file.endsWith('.gz')) {
      throw new Error('Invalid evidence archive');
    }
    if (group !== 'installedProductionDependencies') {
      corpus.update(file);
      corpus.update(bytes);
    }
    const ext = path.extname(originalName).toLowerCase();
    const binary = binaryMedia.has(ext);
    const text = bytes.toString(binary ? 'latin1' : 'utf8');
    const hits = text.toLowerCase().split(retired).length - 1;
    const nameHit = file.toLowerCase().includes(retired);
    if (hits || nameHit) {
      report.retiredPaths.push({ path: file, content: hits, name: Number(nameHit) });
      row.retiredTextHits += hits;
      row.retiredNameHits += Number(nameHit);
      if (
        ['ownedRuntime', 'dependencyManifests', 'builtOutput', 'installedProductionDependencies'].includes(
          group,
        )
      )
        failure = true;
    }
    if (!binary && !extensions.has(ext) && bytes.includes(0)) continue;
    const counts = detections(
      text,
      ext === '.json' || ext === '.jsonl',
      /(?:^|\/)package(?:-lock)?\.json$/.test(file),
    );
    const matches = Object.values(counts).reduce((a, b) => a + b, 0);
    if (matches) {
      row.credentialCandidateOccurrences += matches;
      report.credentialCandidates.push({ path: file, detectors: counts });
    }
    if (['builtOutput', 'ownedRuntime'].includes(group) && !binary) {
      for (const origin of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)(?=[:\/'"<>\s]|$)/g)) {
        const hostname = origin[1].toLowerCase();
        if (!/^[a-z0-9.-]{1,253}$/.test(hostname)) continue;
        const source = (report.runtimeOrigins[hostname] ??= {});
        source[file] = (source[file] ?? 0) + 1;
      }
    }
  }
  report.contentDigest = corpus.digest('hex');
  report.retiredRuntimeReferences = failure;
  const sensitiveGroups = new Set([
    'referenceEvidence',
    'parityEvidence',
    'ownedRuntime',
    'builtOutput',
    'dependencyManifests',
  ]);
  report.requiresCredentialReview = report.credentialCandidates.some(({ path, detectors }) =>
    Object.keys(detectors).some(
      (detector) =>
        Object.hasOwn(knownSignatures, detector) ||
        (detector !== 'package-version-named-cookie' && sensitiveGroups.has(scope(path))),
    ),
  );
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(
    JSON.stringify(
      {
        groups: report.groups,
        archivedFiles: report.archivedFiles,
        productionPackages: packageCount,
        retiredRuntimeReferences: failure,
        requiresCredentialReview: report.requiresCredentialReview,
        credentialCandidateFiles: report.credentialCandidates.length,
        missingFiles: report.missingFiles.length,
      },
      null,
      2,
    ),
  );
  if (failure || report.requiresCredentialReview) process.exitCode = 1;
}

main().catch((error) => {
  const location = String(error.stack || '')
    .split('\n')
    .find((line) => line.includes('audit-release.mjs:'))
    ?.match(/audit-release\.mjs:(\d+):/)?.[1];
  console.error(
    JSON.stringify({ auditError: error.name, code: error.code, scriptLine: location, path: currentPath }),
  );
  process.exitCode = 2;
});
