import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../server/app';
import { hostingJobLimits } from '../server/hosting-jobs';
import type { PageReader } from '../server/health-pages';

const path = '/api/hosting/jobs';
const origin = 'https://releasegate.example';
const account = 'tester@releasegate.local';
const password = () => randomBytes(24).toString('hex');

async function setup(t: TestContext, enabled = true, readHealthPage?: PageReader) {
  const pass = password();
  const app = await buildApp({
    databasePath: ':memory:', dataDir: resolve('.work/hosting-job-tests'), serveClient: false, readHealthPage,
    env: { DEMO_ADMIN_EMAIL: account, DEMO_ADMIN_PASSWORD: pass, PUBLIC_ORIGIN: origin,
      ...(enabled && { RELEASEGATE_NETLIFY_JOBS: 'true' }) },
  });
  t.after(() => app.close());
  async function login() {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: account, password: pass } });
    assert.equal(response.statusCode, 200);
    return response.cookies[0].name + '=' + response.cookies[0].value;
  }
  const cookie = await login();
  const start = (payload: object, session = cookie) => app.inject({
    method: 'POST', url: path, payload, headers: { cookie: session, origin },
  });
  const poll = (id: string, session = cookie) => app.inject({ method: 'GET', url: path + '/' + id, headers: { cookie: session } });
  async function result(id: string) {
    const end = Date.now() + 15_000;
    while (Date.now() < end) {
      const response = await poll(id);
      if (response.statusCode !== 202) return response;
      assert.deepEqual(response.json(), { pending: true });
      await delay(10);
    }
    throw new Error('The test job did not finish.');
  }
  return { app, cookie, login, start, poll, result };
}

test('hosted jobs are opt-in and preserve authentication, origin checks and a narrow route allowlist', async t => {
  const off = await setup(t, false);
  const input = { method: 'POST', path: '/api/healthchecks', body: {} };
  assert.equal((await off.start(input)).statusCode, 404);
  const f = await setup(t);
  assert.equal((await f.start(input, '')).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'POST', url: path, headers: { origin: 'https://other.example', cookie: f.cookie }, payload: input })).statusCode, 403);
  const visitor = await f.app.inject({
    method: 'POST', url: '/api/auth/register', payload: { email: 'viewer@releasegate.local', full_name: 'Viewer', password: password() },
  });
  assert.equal(visitor.statusCode, 201);
  // Self-serve accounts may start website jobs; the original route repeats its own checks.
  assert.equal((await f.start(input, visitor.cookies[0].name + '=' + visitor.cookies[0].value)).statusCode, 202);
  for (const payload of [
    { ...input, path: '/api/healthchecks/inspect-windows' }, { ...input, path: '/api/auth/login' },
    { ...input, path: '/api/hosting/jobs' }, { ...input, path: 'https://other.example/api/healthchecks' },
    { ...input, path: '/api/bugs/../analyses' }, { ...input, path: '/api/bugs/a%2Fb/analyses' },
    { ...input, method: 'PUT' }, { ...input, headers: { cookie: 'forged' } },
    { method: 'GET', path: '/api/healthchecks/example/pdf', body: {} },
  ]) assert.equal((await f.start(payload)).statusCode, 422);
  assert.equal((await f.start({ ...input, body: { data: 'x'.repeat(hostingJobLimits.requestBytes) } })).statusCode, 413);
});

test('a pending check saves once, repeated polls preserve its bytes, and another login cannot see it', async t => {
  let complete!: () => void;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const f = await setup(t, true, async (url) => {
    entered();
    await gate;
    return { url: url.href, status: 200, contentType: 'text/html', body: '<html lang="en"><title>Fixture</title><main><h1>Fixture</h1></main></html>' };
  });
  const input = { method: 'POST', path: '/api/healthchecks', body: {
    target_url: 'https://fixture.example/', follow_links: false, browser_checks: false, authorization_attested: true,
  } };
  const before = (await f.app.inject({ url: '/api/healthchecks', headers: { cookie: f.cookie } })).json().records.length;
  const opened = await f.start(input);
  assert.equal(opened.statusCode, 202);
  const { id } = opened.json();
  assert.match(id, /^[a-f0-9-]{36}$/);
  try {
    await waiting;
    assert.deepEqual((await f.poll(id)).json(), { pending: true });
    assert.equal((await f.poll(id, await f.login())).statusCode, 404);
    assert.equal((await f.poll(id, '')).statusCode, 401);
    const second = await f.start({ method: 'POST', path: '/api/healthchecks/discover-buttons', body: input.body });
    assert.equal(second.statusCode, 202);
    assert.equal((await f.start(input)).statusCode, 429);
  } finally { complete(); }
  const done = await f.result(id);
  assert.equal(done.statusCode, 201);
  assert.equal(done.json().run.check_source, 'website');
  assert.equal(done.headers['cache-control'], 'no-store');
  assert.equal(done.headers['set-cookie'], undefined);
  assert.ok(done.rawPayload.equals((await f.poll(id)).rawPayload));
  const after = (await f.app.inject({ url: '/api/healthchecks', headers: { cookie: f.cookie } })).json().records.length;
  assert.equal(after - before, 1);
  const invalid = await f.start({ ...input, body: {} });
  assert.equal((await f.result(invalid.json().id)).statusCode, 422);
});

test('completed job results expire and free their session ticket slots', async t => {
  const f = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const input = { method: 'POST', path: '/api/healthchecks', body: {} };
  let id: string | undefined;
  for (let index = 0; index < hostingJobLimits.ticketsPerSession; index++) {
    const started = await f.start(input);
    assert.equal(started.statusCode, 202);
    id = started.json().id;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal((await f.poll(id!)).statusCode, 422);
  }
  assert.equal((await f.start(input)).statusCode, 429);
  t.mock.timers.tick(hostingJobLimits.retentionMs + 1);
  assert.equal((await f.poll(id!)).statusCode, 404);
  assert.equal((await f.start(input)).statusCode, 202);
});

test('hosted jobs return original downloads and preserve original error responses for other slow operations', async t => {
  const f = await setup(t);
  const records = (await f.app.inject({ url: '/api/healthchecks', headers: { cookie: f.cookie } })).json().records;
  const pdf = await f.start({ method: 'GET', path: '/api/healthchecks/' + records[0].id + '/pdf' });
  assert.equal(pdf.statusCode, 202);
  const download = await f.result(pdf.json().id);
  assert.equal(download.statusCode, 200);
  assert.equal(download.headers['content-type'], 'application/pdf');
  assert.match(String(download.headers['content-disposition']), /attachment; filename="ReleaseGate-HC-\d+\.pdf"/);
  assert.equal(download.rawPayload.subarray(0, 5).toString(), '%PDF-');
  assert.ok(download.rawPayload.equals((await f.poll(pdf.json().id)).rawPayload));
  for (const [target, expected] of [['/api/healthchecks/discover-buttons', 422], ['/api/bugs/missing/analyses', 404]] as const) {
    const input = { method: 'POST', path: target, body: {} };
    const direct = await f.app.inject({ method: 'POST', url: target, payload: {}, headers: { cookie: f.cookie, origin } });
    const ticket = await f.start(input);
    assert.equal(ticket.statusCode, 202);
    const job = await f.result(ticket.json().id);
    assert.equal(job.statusCode, expected);
    assert.equal(job.statusCode, direct.statusCode);
    assert.ok(job.rawPayload.equals(direct.rawPayload));
  }
});
