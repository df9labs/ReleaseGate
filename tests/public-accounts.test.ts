import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { buildApp } from '../server/app';
import { readPublicPage } from '../server/health-transport';
import type { Mail } from '../server/mailer';

const password = () => randomBytes(18).toString('base64url');
const sample = {
  sample_site: true, follow_links: false, browser_checks: false, target_url: '', target_name: 'Sample',
  target_type: 'website', environment: 'preview', authorization_attested: true,
};

async function setup(t: TestContext, env: Record<string, string> = {}, databasePath = ':memory:') {
  const root = resolve('.work/public-account-runs');
  mkdirSync(root, { recursive: true });
  const dataDir = mkdtempSync(join(root, 'case-'));
  const mail: Mail[] = [];
  const admin = password();
  const app = await buildApp({
    env: { DEMO_ADMIN_EMAIL: 'admin@releasegate.local', DEMO_ADMIN_PASSWORD: admin, PUBLIC_ORIGIN: 'https://rg.example', ...env },
    dataDir, databasePath: databasePath === ':memory:' ? databasePath : join(dataDir, databasePath), serveClient: false,
    sendMail: async (m) => { mail.push(m); },
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  t.after(async () => {
    await app.close();
    if (resolve(dataDir).startsWith(root + sep)) rmSync(dataDir, { recursive: true, force: true });
  });
  const call = (method: 'GET' | 'POST', url: string, cookie = '', payload?: object) =>
    app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
  const cookieOf = (r: Awaited<ReturnType<typeof call>>) => r.cookies.map((c) => c.name + '=' + c.value).join('; ');
  const signUp = async (email: string) => {
    const r = await call('POST', '/api/auth/register', '', { email, full_name: 'Visitor', password: password() });
    assert.equal(r.statusCode, 201);
    return cookieOf(r);
  };
  const adminCookie = cookieOf(await call('POST', '/api/auth/login', '', { email: 'admin@releasegate.local', password: admin }));
  return { app, call, signUp, adminCookie, mail, adminPassword: admin };
}

test('a self-serve account runs its own scans, sees only its own runs, and stops at its daily allowance', async (t) => {
  const f = await setup(t, { PUBLIC_SCANS_PER_USER_DAILY: '2', PUBLIC_SCANS_TOTAL_DAILY: '3' });
  const alice = await f.signUp('alice@example.com'), bob = await f.signUp('bob@example.com');
  const first = await f.call('POST', '/api/healthchecks', alice, sample);
  assert.equal(first.statusCode, 201);
  const run = first.json().run;
  assert.equal((await f.call('GET', '/api/healthchecks', alice)).json().records.length, 1);
  assert.equal((await f.call('GET', '/api/healthchecks', bob)).json().records.length, 0);
  assert.equal((await f.call('GET', '/api/healthchecks/' + run.id, bob)).statusCode, 404);
  assert.equal((await f.call('GET', '/api/healthchecks/' + run.id, f.adminCookie)).statusCode, 200);
  assert.equal((await f.call('POST', '/api/healthchecks', alice, sample)).statusCode, 201);
  const capped = await f.call('POST', '/api/healthchecks', alice, sample);
  assert.equal(capped.statusCode, 429);
  assert.match(capped.json().message, /2 free scans/);
  assert.equal((await f.call('GET', '/api/auth/session', alice)).json().account.scans_remaining, 0);
  assert.equal((await f.call('POST', '/api/healthchecks', bob, sample)).statusCode, 201);
  const total = await f.call('POST', '/api/healthchecks', bob, sample);
  assert.equal(total.statusCode, 429);
  assert.match(total.json().message, /today's limit/);
  assert.equal((await f.call('POST', '/api/healthchecks', f.adminCookie, sample)).statusCode, 201);
});

test('the daily allowance survives a restart', async () => {
  const root = resolve('.work/public-account-runs');
  mkdirSync(root, { recursive: true });
  const dataDir = mkdtempSync(join(root, 'restart-')), databasePath = join(dataDir, 'shared.sqlite');
  const env = { DEMO_ADMIN_EMAIL: 'admin@releasegate.local', DEMO_ADMIN_PASSWORD: password(), PUBLIC_SCANS_PER_USER_DAILY: '1' };
  const user = { email: 'carol@example.com', full_name: 'Carol', password: password() };
  const first = await buildApp({ env, dataDir, databasePath, serveClient: false });
  await first.listen({ port: 0, host: '127.0.0.1' });
  const signed = await first.inject({ method: 'POST', url: '/api/auth/register', payload: user });
  const cookie = signed.cookies.map((c) => c.name + '=' + c.value).join('; ');
  assert.equal((await first.inject({ method: 'POST', url: '/api/healthchecks', payload: sample, headers: { cookie } })).statusCode, 201);
  await first.close();
  const second = await buildApp({ env, dataDir, databasePath, serveClient: false });
  await second.listen({ port: 0, host: '127.0.0.1' });
  try {
    const again = await second.inject({ method: 'POST', url: '/api/auth/login', payload: { email: user.email, password: user.password } });
    const fresh = again.cookies.map((c) => c.name + '=' + c.value).join('; ');
    assert.equal((await second.inject({ method: 'POST', url: '/api/healthchecks', payload: sample, headers: { cookie: fresh } })).statusCode, 429);
  } finally {
    await second.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('with email configured, scanning waits for a confirmed address', async (t) => {
  const f = await setup(t, { RESEND_API_KEY: 're_test', MAIL_FROM: 'ReleaseGate <noreply@rg.example>' });
  const cookie = await f.signUp('dana@example.com');
  assert.equal(f.mail.length, 1);
  assert.equal(f.mail[0].to, 'dana@example.com');
  assert.deepEqual((await f.call('GET', '/api/healthchecks', cookie)).json().records, []);
  assert.equal((await f.call('POST', '/api/auth/resend-verification', cookie)).statusCode, 429);
  const blocked = await f.call('POST', '/api/healthchecks', cookie, sample);
  assert.equal(blocked.statusCode, 403);
  assert.match(blocked.json().message, /Confirm your email/);
  const token = new URL(/https:\S+/.exec(f.mail[0].text)![0]).searchParams.get('token');
  assert.equal((await f.call('POST', '/api/auth/verify-email', '', { token: 'wrong' })).statusCode, 422);
  assert.equal((await f.call('POST', '/api/auth/verify-email', '', { token })).statusCode, 200);
  assert.equal((await f.call('POST', '/api/auth/verify-email', '', { token })).statusCode, 422);
  assert.equal((await f.call('POST', '/api/healthchecks', cookie, sample)).statusCode, 201);
  await f.call('POST', '/api/auth/forgot-password', '', { email: 'dana@example.com' });
  assert.equal(f.mail.length, 2);
  assert.match(f.mail[1].text, /https:\/\/rg\.example\/reset-password\?token=/);
});

test('failed sign-ins lock only the targeted account after ten attempts', async (t) => {
  const f = await setup(t);
  await f.signUp('erin@example.com');
  for (let i = 0; i < 10; i++)
    assert.equal((await f.call('POST', '/api/auth/login', '', { email: 'erin@example.com', password: 'wrong-guess' })).statusCode, 401);
  assert.equal((await f.call('POST', '/api/auth/login', '', { email: 'erin@example.com', password: 'wrong-guess' })).statusCode, 429);
  assert.equal((await f.call('GET', '/api/auth/session', f.adminCookie)).statusCode, 200);
  for (let i = 0; i < 12; i++)
    assert.equal((await f.call('POST', '/api/auth/login', '', { email: 'admin@releasegate.local', password: 'still-wrong' })).statusCode, 401);
  // Strangers can't lock the operator out: the admin's correct password still works.
  assert.equal((await f.call('POST', '/api/auth/login', '', { email: 'admin@releasegate.local', password: f.adminPassword })).statusCode, 200);
});

test('self-serve accounts cannot reach operator settings, stats or desktop inspection', async (t) => {
  const f = await setup(t);
  const cookie = await f.signUp('fred@example.com');
  for (const url of ['/api/settings', '/api/audit', '/api/stats'])
    assert.equal((await f.call('GET', url, cookie)).statusCode, 403);
  const dashboard = (await f.call('GET', '/api/dashboard', cookie)).json();
  assert.deepEqual([dashboard.bugs, dashboard.versions], [[], []]);
  assert.equal((await f.call('POST', '/api/healthchecks', cookie, { ...sample, desktop_inspection: {} })).statusCode, 422);
});

test('scan targets on private, tailnet and metadata addresses are refused before any request', async () => {
  for (const target of [
    'http://127.0.0.1/', 'http://10.0.0.5/', 'http://172.16.0.1/', 'http://192.168.1.152/', 'http://169.254.169.254/',
    'http://100.101.102.103/', 'http://100.64.0.1/', 'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/', 'https://machine.example-tailnet.ts.net/', 'http://localhost/', 'http://printer.local/',
  ]) {
    await assert.rejects(readPublicPage(new URL(target), { signal: AbortSignal.timeout(5000) }),
      (error: Error) => /public|Private|private/.test(error.message), target);
  }
});

test('each account keeps its own bugs and version numbers', async (t) => {
  const f = await setup(t);
  const a = await f.signUp('gina@example.com'), b = await f.signUp('hal@example.com');
  const report = { title: 'Menu stays closed', description: 'Clicking Menu does nothing.', affected_module: 'Header', severity: 'medium',
    actual_behavior: 'Nothing happens', expected_behavior: 'Menu opens', evidence: 'Seen on phone.' };
  const bug = (await f.call('POST', '/api/reports', a, report)).json().bug;
  assert.equal((await f.call('GET', '/api/bugs/' + bug.id, b)).statusCode, 404);
  const analysed = await f.call('POST', '/api/bugs/' + bug.id + '/analyses', a, {});
  assert.equal(analysed.statusCode, 200, analysed.body);
  assert.equal((await f.call('POST', '/api/bugs/' + bug.id + '/analyses', b, {})).statusCode, 404);
  assert.deepEqual((await f.call('GET', '/api/bugs', b)).json().records, []);
  assert.equal((await f.call('GET', '/api/bugs', f.adminCookie)).json().records.some((r: { id: string }) => r.id === bug.id), true);
  const version = { semantic_version: '1.0.0', change_type: 'baseline', title: 'First', summary: 'Baseline', changes: 'Initial', reason: 'Start' };
  const first = await f.call('POST', '/api/versions', a, version);
  assert.equal(first.statusCode, 201, first.body);
  assert.equal((await f.call('POST', '/api/versions', b, version)).statusCode, 201);
  assert.equal((await f.call('POST', '/api/versions', a, version)).statusCode, 409);
  assert.equal((await f.call('GET', '/api/versions', b)).json().records.length, 1);
  assert.equal((await f.call('POST', '/api/versions/' + first.json().version.id + '/release', b)).statusCode, 404);
});
