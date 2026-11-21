import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';
import type { HTTPMethods } from 'fastify';
import type { Healthcheck } from '../src/api';
import { buildApp } from '../server/app';
import type { PageReader } from '../server/health-pages';
import {
  createDemoEngine,
  createLlmAnalyser,
  type DemoEngine,
  type ProposalOnlyEngine,
} from '../server/engine/index';

const report = {
  title: 'Client card does not expand',
  description: 'Clicking the summary leaves the details closed.',
  affected_module: 'Dashboard',
  severity: 'medium',
  actual_behavior: 'Details remain closed',
  expected_behavior: 'Details expand',
  evidence: 'Observed in the preview fixture.',
};
const password = () => randomBytes(22).toString('base64url');
async function fixture(
  t: TestContext,
  extra: Record<string, string> = {},
  persist = false,
  engine?: DemoEngine | ProposalOnlyEngine,
  readHealthPage?: PageReader,
  inspectWindows?: (signal: AbortSignal) => Promise<unknown>,
) {
  const root = resolve('.work/api-test-runs');
  mkdirSync(root, { recursive: true });
  const dataDir = mkdtempSync(join(root, 'case-')),
    pass = password(),
    key = password();
  const env = {
    DEMO_ADMIN_EMAIL: 'admin@releasegate.local',
    DEMO_ADMIN_PASSWORD: pass,
    DF9_INTAKE_KEY: key,
    ...extra,
  };
  const path = persist ? join(dataDir, 'test.sqlite') : ':memory:';
  const app = await buildApp({
    env,
    dataDir,
    databasePath: path,
    serveClient: false,
    engine,
    readHealthPage,
    inspectWindows,
  });
  t.after(async () => {
    await app.close();
    if (resolve(dataDir).startsWith(root + sep)) rmSync(dataDir, { recursive: true, force: true });
  });
  async function call(
    method: HTTPMethods,
    url: string,
    payload?: object,
    cookie = '',
    headers: Record<string, string> = {},
  ) {
    return await app.inject({
      method,
      url,
      payload,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    });
  }
  const cookieOf = (response: Awaited<ReturnType<typeof call>>) =>
    response.cookies.map((c) => c.name + '=' + c.value).join('; ');
  const login = await call('POST', '/api/auth/login', { email: env.DEMO_ADMIN_EMAIL, password: pass });
  assert.equal(login.statusCode, 200);
  const admin = cookieOf(login);
  const request = async (
    method: HTTPMethods,
    url: string,
    payload?: object,
    expected = 200,
    cookie = admin,
    headers: Record<string, string> = {},
  ) => {
    const result = await call(method, url, payload, cookie, headers);
    assert.equal(
      result.statusCode,
      expected,
      method + ' ' + url + ' ' + (result.statusCode >= 400 ? result.body : ''),
    );
    return result.statusCode === 204 ? undefined : result.json();
  };
  return { app, env, path, dataDir, pass, key, call, cookieOf, admin, request, login };
}
type Harness = Awaited<ReturnType<typeof fixture>>;
test('desktop inspection uses a local picker, saves fresh evidence once and binds it to the admin session', async (t) => {
  let notifyOpened!: () => void;
  let finishPicker!: () => void;
  const opened = new Promise<void>((resolve) => { notifyOpened = resolve; });
  const finished = new Promise<void>((resolve) => { finishPicker = resolve; });
  const inspection = {
    application: 'Studio.exe',
    buttons: [{ name: 'Show preview', enabled: true }],
    checks: [{ button: 'Show preview', expected: 'Preview panel', outcome: 'passed' }],
    limitations: [],
  };
  let calls = 0;
  const f = await fixture(t, {}, false, undefined, undefined, async () => {
    calls++;
    if (calls > 1) return { cancelled: true };
    notifyOpened();
    await finished;
    return inspection;
  });
  const base = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const path = '/api/healthchecks/inspect-windows';
  const attested = { authorization_attested: true };
  const inspect = (body: object, headers: Record<string, string> = {}) => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: f.admin, ...headers },
    body: JSON.stringify(body),
  });
  assert.equal((await inspect({})).status, 422);
  assert.equal((await inspect({ ...attested, path: 'Studio.exe' })).status, 422);
  assert.equal((await inspect(attested, { 'X-Forwarded-For': '127.0.0.1' })).status, 403);
  assert.equal((await inspect(attested, { origin: 'https://example.test' })).status, 403);
  assert.equal(calls, 0);
  const initial = (await f.request('GET', '/api/healthchecks')).records.length;
  const pending = inspect(attested);
  await Promise.race([opened, pending.then(response => {
    throw new Error('Picker request ended before the native inspector opened (' + response.status + ').');
  })]);
  try { assert.equal((await inspect(attested)).status, 409); }
  finally { finishPicker(); }
  const pickerResult = await pending;
  assert.equal(pickerResult.status, 200);
  const capture = await pickerResult.json();
  assert.equal(capture.application, 'Studio.exe');
  assert.ok(Date.parse(capture.captured_at));
  assert.deepEqual(await (await inspect(attested)).json(), { cancelled: true });
  assert.equal((await f.request('GET', '/api/healthchecks')).records.length, initial);
  const payload = { ...attested, target_type: 'internal_tool', desktop_inspection: capture };
  const save = '/api/healthchecks';
  await f.request('POST', save, { ...payload, desktop_inspection: { ...capture, application: 'Another.exe' } }, 409);
  const otherLogin = await f.call('POST', '/api/auth/login', { email: f.env.DEMO_ADMIN_EMAIL, password: f.pass });
  await f.request('POST', save, payload, 409, f.cookieOf(otherLogin));
  const { run } = await f.request('POST', save, payload, 201);
  assert.equal(run.check_source, 'desktop');
  assert.equal(run.desktop_inspection.application, 'Studio.exe');
  assert.deepEqual((await f.request('GET', save + '/' + run.id)).run.desktop_inspection, run.desktop_inspection);
  await f.request('POST', save, payload, 409);
  assert.equal((await f.request('GET', save)).records.length, initial + 1);
});
test('button discovery reads the starting page and returns selectable browser names without saving a run', async (t) => {
  const path = '/api/healthchecks/discover-buttons';
  const reads: string[] = [];
  const { request } = await fixture(t, {}, false, undefined, async url => {
    reads.push(url.pathname);
    return {
      status: 200, url: url.href, contentType: 'text/html',
      body: '<label id="name">Show details</label><button aria-labelledby="name" aria-expanded="false" aria-controls="detail"></button><p id="detail" hidden>Details</p>' +
        '<input type="submit" value="Send"><button disabled>Later</button><button>More</button><button>More</button><button></button>' +
        '<a href="/elsewhere">Another page</a><button hidden>Hidden</button>',
    };
  });
  const payload = { target_url:'https://owned.example/', authorization_attested:true };
  await request('POST', path, {...payload, authorization_attested:false}, 422);
  await request('POST', path, {...payload, target_url:payload.target_url+'?page=2'}, 422);
  assert.equal(reads.length, 0);
  const original = (await request('GET','/api/healthchecks')).records.length;
  const data = await request('POST',path,payload);
  assert.equal(data.total,6);
  assert.deepEqual(data.buttons.find((b: {name:string})=>b.name==='Show details'),
    { name:'Show details', disabled:false, ambiguous:false, automatic:true, selectable:true });
  for (const name of ['Send','More','Later','']) assert.equal(data.buttons.find((b: {name:string})=>b.name===name).selectable,false);
  assert.equal(data.buttons.some((b: {name:string})=>b.name==='Hidden'),false);
  assert.deepEqual(reads,['/']);
  assert.equal((await request('GET','/api/healthchecks')).records.length,original);
});
async function toProof(f: Harness) {
  const { request } = f;
  const created = await request('POST', '/api/reports', report, 201),
    id = created.bug.id,
    root = '/api/bugs/' + id;
  await request(
    'POST',
    root + '/verifications',
    { environment: 'preview', result: 'passed', observed_result: 'test', evidence: 'test' },
    409,
  );
  await request('POST', root + '/analyses', {});
  await request('POST', root + '/repairs', { summary: 'Plan only' }, 422);
  await request('POST', root + '/repairs', {
    summary: 'Repair disclosure control',
    checkpoint_reference: 'fixture:before',
    planned_tests: ['Open details'],
  });
  await request('POST', root + '/implementation', {
    summary: 'Apply the preview fixture change',
    evidence: 'Controlled preview change',
    reference: 'fixture:after',
  });
  await request('POST', root + '/verifications', {
    environment: 'preview',
    result: 'passed',
    observed_result: 'Details expanded',
    evidence: 'Checked the preview',
  });
  return id as string;
}
const versionFields = {
  semantic_version: '1.0.0',
  title: 'Preview repair',
  summary: 'Corrected the disclosure behaviour',
  changes: 'Open the panel',
  reason: 'Restore the user journey',
};

test('authenticated journey persists tested preview proof, an explicit gate and separate release evidence', async (t) => {
  const f = await fixture(t),
    { request } = f;
  const before = await request('GET', '/api/dashboard');
  assert.deepEqual(
    [before.stats.total, before.stats.manual, before.stats.readiness, before.versions.length],
    [1, 1, 0, 0],
  );
  const id = await toProof(f),
    root = '/api/bugs/' + id;
  const record = await request('GET', root);
  assert.equal(record.verifications[0].proof.passed, true);
  assert.ok(
    record.verifications[0].proof.checks.some(
      (check: { beforePassed: boolean; afterPassed: boolean }) => !check.beforePassed && check.afterPassed,
    ),
  );
  assert.equal(record.bug.gate_status, 'pending');
  await request('POST', '/api/versions', { ...versionFields, linked_bug_ids: [id] }, 409);
  await request('POST', root + '/gate', {
    decision: 'approve',
    reason: 'Preview receipt and checks reviewed.',
  });
  await request('POST', root + '/gate', { decision: 'approve', reason: 'Repeated' }, 409);
  await request(
    'POST',
    root + '/verifications',
    { environment: 'live', result: 'passed', observed_result: 'unreleased', evidence: 'premature' },
    409,
  );
  const { version } = await request('POST', '/api/versions', { ...versionFields, linked_bug_ids: [id] }, 201);
  await request('POST', '/api/versions', { ...versionFields, linked_bug_ids: [] }, 409);
  const v = '/api/versions/' + version.id;
  await request('POST', v + '/verify', { result: 'passed', evidence: 'early' }, 409);
  await request('POST', v + '/release', {});
  await request('POST', v + '/release', {}, 409);
  assert.equal((await request('GET', root)).bug.production_verification_status, 'published_unverified');
  await request('POST', v + '/verify', {
    result: 'passed',
    evidence: 'Observed the released local demonstration.',
  });
  await request('POST', v + '/verify', { result: 'passed', evidence: 'again' }, 409);
  const dashboard = await request('GET', '/api/dashboard');
  assert.deepEqual(
    [
      dashboard.stats.total,
      dashboard.stats.previewPassed,
      dashboard.stats.livePassed,
      dashboard.stats.readiness,
    ],
    [2, 1, 1, 50],
  );
  assert.equal(dashboard.stats.currentVersion.semantic_version, '1.0.0');
  const viewer = await f.call('POST', '/api/auth/register', {
    full_name: 'Reader',
    email: 'reader@releasegate.test',
    password: password(),
  });
  const restricted = await request('GET', '/api/dashboard', undefined, 200, f.cookieOf(viewer));
  // Self-serve accounts never see the operator's release records.
  assert.deepEqual(restricted.versions, []);
  assert.deepEqual(restricted.bugs, []);
  assert.equal(restricted.stats.currentVersion?.semantic_version, undefined);
  assert.equal((await request('GET', root)).bug.status, 'resolved');
  assert.equal((await request('GET', '/api/versions')).records.length, 1);
  assert.equal((await request('GET', '/api/search?q=1.0.0')).records[0].id, id);
  assert.ok((await request('GET', '/api/notifications')).notifications.length);
  assert.ok(
    (await request('GET', '/api/audit')).events.some((e: { action: string }) => e.action === 'gate.approved'),
  );
});
test('session boundaries, admin-only mutations, self-service roles, non-enumerating recovery and token revocation', async (t) => {
  const f = await fixture(t),
    { request, call, admin, cookieOf } = f;
  assert.ok(f.login.cookies[0].httpOnly);
  assert.equal(f.login.cookies[0].sameSite, 'Strict');
  await request('GET', '/api/auth/session', undefined, 401, '');
  for (const path of [
    '/api/dashboard',
    '/api/bugs',
    '/api/search',
    '/api/notifications',
    '/api/healthchecks',
    '/api/healthchecks/x/pdf',
    '/api/versions',
    '/api/settings',
    '/api/audit',
  ]) {
    await request('GET', path, undefined, 401, '');
  }
  await request('POST', '/api/auth/login', { email: f.env.DEMO_ADMIN_EMAIL, password: 'invalid' }, 401, '');
  const address = 'reporter@releasegate.test',
    pw = password();
  const register = await call('POST', '/api/auth/register', {
    email: address,
    full_name: 'Test Reporter',
    password: pw,
    role: 'admin',
  });
  assert.equal(register.statusCode, 201);
  assert.equal(register.json().user.role, 'user');
  const visitor = cookieOf(register);
  assert.equal((await request('GET', '/api/auth/session', undefined, 200, visitor)).user.role, 'user');
  await request(
    'POST',
    '/api/auth/register',
    { email: address, full_name: 'Test Reporter', password: pw },
    409,
    '',
  );
  // A self-serve account sees only its own (here: no) healthchecks, and none of the operator's records.
  assert.deepEqual((await request('GET', '/api/healthchecks', undefined, 200, visitor)).records, []);
  await request('GET', '/api/healthchecks/x', undefined, 404, visitor);
  await request('GET', '/api/healthchecks/x/pdf', undefined, 404, visitor);
  for (const path of ['/api/settings', '/api/audit'])
    await request('GET', path, undefined, 403, visitor);
  assert.deepEqual((await request('GET', '/api/versions', undefined, 200, visitor)).records, []);
  assert.deepEqual((await request('GET', '/api/notifications', undefined, 200, visitor)).notifications, []);
  // Self-serve accounts log and work their own bugs; the operator's records stay invisible to them.
  const theirs = (await request('POST', '/api/reports', report, 201, visitor)).bug;
  assert.equal((await request('GET', '/api/bugs/' + theirs.id, undefined, 200, visitor)).bug.id, theirs.id);
  assert.deepEqual((await request('GET', '/api/bugs', undefined, 200, visitor)).records.map((b: { id: string }) => b.id), [theirs.id]);
  const own = (await request('POST', '/api/reports', report, 201)).bug;
  await request('GET', '/api/bugs/' + own.id, undefined, 404, visitor);
  for (const endpoint of [
    'analyses',
    'repairs',
    'repairs/apply-safe',
    'implementation',
    'verifications',
    'gate',
    'reopen',
  ]) {
    await request('POST', '/api/bugs/' + own.id + '/' + endpoint, {}, 404, visitor);
  }
  await request('PUT', '/api/settings', {}, 403, visitor);
  await request('POST', '/api/versions', {}, 422, visitor);
  await request('POST', '/api/versions/x/release', {}, 404, visitor);
  await request('POST', '/api/versions/x/verify', {}, 404, visitor);
  await request('POST', '/api/healthchecks', {}, 422, visitor);
  await request('POST', '/api/healthchecks/discover-buttons', {}, 401, '');
  await request('POST', '/api/healthchecks/discover-buttons', {}, 422, visitor);
  await request('POST', '/api/healthchecks/inspect-windows', {}, 401, '');
  await request('POST', '/api/healthchecks/inspect-windows', {}, 403, visitor);
  await request('POST', '/api/healthchecks/x/findings/y/bug', {}, 404, visitor);
  const seeded = (await request('GET', '/api/bugs?limit=500')).records.find(
    (b: { bug_number: string }) => b.bug_number === 'RP-2965',
  );
  await request('PATCH', '/api/bugs/' + seeded.id, { evidence: 'unowned' }, 403, visitor);
  await request('PATCH', '/api/bugs/' + own.id, { evidence: 'not theirs' }, 403, visitor);
  await request('PUT', '/api/settings', { app_name: 'no cross-origin write' }, 403, admin, {
    origin: 'https://elsewhere.test',
  });
  const missing = await request(
    'POST',
    '/api/auth/forgot-password',
    { email: 'missing@releasegate.test' },
    200,
    '',
  );
  const real = await request('POST', '/api/auth/forgot-password', { email: address }, 200, '');
  assert.deepEqual(missing, real);
  assert.ok(!JSON.stringify(real).includes('token='));
  const outbox = join(f.dataDir, 'outbox'),
    file = readdirSync(outbox)[0];
  const link = JSON.parse(readFileSync(join(outbox, file), 'utf8')).path as string;
  const token = new URL(link, 'http://fixture.test').searchParams.get('token');
  await request('POST', '/api/auth/reset-password', { token, password: password() }, 200, '');
  await request('POST', '/api/auth/reset-password', { token, password: password() }, 422, '');
  await request('GET', '/api/auth/session', undefined, 401, visitor);
  await request('POST', '/api/auth/logout', undefined, 204);
  await request('GET', '/api/auth/session', undefined, 401, admin);
});
test('scoped report intake is idempotent and a sender cannot authorise other routes', async (t) => {
  const other = password(),
    f = await fixture(t, { DF9_INTAKE_KEYS: JSON.stringify({ portal: other }) });
  const send = (key: string, body: object, code: number, idem = 'same-key') =>
    f.request('POST', '/api/reports', body, code, '', {
      authorization: 'Bearer ' + key,
      'idempotency-key': idem,
    });
  await send('invalid', report, 401);
  await f.request('POST', '/api/reports', report, 422, '', { authorization: 'Bearer ' + f.key });
  const [a, b] = await Promise.all([send(f.key, report, 201), send(f.key, report, 200)]);
  assert.equal(a.bug.id, b.bug.id);
  assert.equal(a.bug.analysis_count, 1);
  await send(f.key, { ...report, title: 'Different' }, 409);
  const second = await send(other, report, 201);
  assert.notEqual(second.bug.id, a.bug.id);
  await f.request('GET', '/api/audit', undefined, 401, '', { authorization: 'Bearer ' + other });
  assert.equal((await f.request('GET', '/api/bugs?offset=0&limit=1')).records.length, 1);
  await f.request('GET', '/api/bugs?limit=501', undefined, 422);
});
test('allowlisted duplicates require a current canonical record, current policy and verified fixture', async (t) => {
  const f = await fixture(t),
    { request } = f;
  const base = (await request('GET', '/api/bugs')).records[0],
    input = {
      ...report,
      title: 'Duplicate report',
      duplicate_candidate_id: base.id,
      evidence: 'Duplicate of ' + base.id,
    };
  const bug = (await request('POST', '/api/reports', input, 201)).bug,
    root = '/api/bugs/' + bug.id;
  await request('POST', root + '/analyses', { deep: true }, 409);
  await request('POST', root + '/analyses', {});
  await request('PUT', '/api/settings', { automation_enabled: false });
  await request('POST', root + '/repairs/apply-safe', {}, 409);
  await request('PUT', '/api/settings', { automation_enabled: true });
  await request('PATCH', '/api/bugs/' + base.id, { evidence: 'Updated canonical evidence' });
  await request('POST', root + '/repairs/apply-safe', {}, 409);
  await request('POST', root + '/analyses', { deep: true });
  const applied = await request('POST', root + '/repairs/apply-safe', {});
  assert.equal(applied.bug.gate_status, 'automatic');
  assert.equal(applied.bug.status, 'duplicate');
  await request('POST', root + '/repairs/apply-safe', {}, 409);
  assert.equal((await request('GET', root)).verifications.length, 1);
  await request('POST', root + '/reopen', { reason: 'New report evidence.' });
  assert.equal((await request('GET', root)).bug.gate_status, null);
});
test('drafts cannot release changed proof and rejected gates do not permit publication', async (t) => {
  const f = await fixture(t),
    { request } = f;
  const rejected = await toProof(f);
  await request('POST', '/api/bugs/' + rejected + '/gate', {
    decision: 'reject',
    reason: 'Requires further testing.',
  });
  await request('POST', '/api/versions', { ...versionFields, linked_bug_ids: [rejected] }, 409);
  const id = await toProof(f);
  await request('POST', '/api/bugs/' + id + '/gate', { decision: 'approve', reason: 'Checked.' });
  const { version } = await request('POST', '/api/versions', { ...versionFields, linked_bug_ids: [id] }, 201);
  await request('PATCH', '/api/bugs/' + id, { evidence: 'Updated after review' });
  await request('POST', '/api/versions/' + version.id + '/release', {}, 409);
  await request('PATCH', '/api/bugs/' + id, { status: 'resolved' }, 422);
  await request('PATCH', '/api/bugs/' + id, { revision: 1, evidence: 'Stale' }, 409);
});
test('PDF export returns a tagged attachment for a saved Healthcheck and preserves its evidence', async (t) => {
  const { request, call, admin } = await fixture(t);
  const before = await request('GET', '/api/healthchecks');
  const selected: Healthcheck = before.records[0];
  const path = '/api/healthchecks/' + selected.id + '/pdf';
  await request('GET', '/api/healthchecks/missing/pdf', undefined, 404);
  const response = await call('GET', path, undefined, admin);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.equal(response.headers['content-disposition'], `attachment; filename="ReleaseGate-${selected.healthcheck_number}.pdf"`);
  assert.equal(response.headers['cache-control'], 'no-store');
  const bytes = response.rawPayload.toString('latin1');
  assert.match(bytes, /^%PDF-/);
  assert.match(bytes, /\/Type\s*\/Page\b/);
  assert.match(bytes, /\/StructTreeRoot\b/);
  assert.match(bytes, /%%EOF\s*$/);
  assert.deepEqual(await request('GET', '/api/healthchecks'), before);

  const launcher = t.mock.method(chromium, 'launch', async () => { throw new Error('internal browser detail'); });
  const head = await call('HEAD', path, undefined, admin);
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers['content-disposition'], response.headers['content-disposition']);
  assert.equal(head.headers['content-length'], undefined);
  assert.equal(head.rawPayload.byteLength, 0);
  assert.equal(launcher.mock.callCount(), 0);
  const error = await call('GET', path, undefined, admin);
  assert.equal(error.statusCode, 503);
  assert.equal(error.headers['content-disposition'], undefined);
  assert.doesNotMatch(error.body, /internal browser detail/);
});

test('settings, local healthcheck and repeated finding conversion preserve a single traceable report', async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request('GET', '/api/healthchecks')).records.length, 13);
  await request('GET', '/api/healthchecks/missing', undefined, 404);
  await request('GET', '/api/bugs/absent', undefined, 404);
  await request('PUT', '/api/settings', { preview_url: 'javascript:alert(1)' }, 422);
  await request('PUT', '/api/settings', { reference_prefix: 'WAY_TOO_LONG' }, 422);
  const { config } = await request('PUT', '/api/settings', {
    app_name: 'DF9 Preview',
    reference_prefix: 'DF9',
  });
  assert.equal((await request('GET', '/api/settings')).config.app_name, config.app_name);
  await request('POST', '/api/healthchecks', { target_url: 'https://unused.test' }, 422);
  const { run } = await request(
    'POST',
    '/api/healthchecks',
    {
      supplied_evidence:
        'FAIL: Summary card is blank\nThe preview was checked manually with the supplied fixture.',
      authorization_attested: true,
    },
    201,
  );
  assert.equal((await request('GET', '/api/healthchecks/' + run.id)).run.id, run.id);
  const path = '/api/healthchecks/' + run.id + '/findings/' + run.findings[0].id + '/bug';
  const a = await request('POST', path, {}),
    b = await request('POST', path, {});
  assert.equal(a.bug.id, b.bug.id);
  assert.match(a.bug.bug_number, /^DF9-/);
  assert.equal(a.bug.source_healthcheck_id, run.id);
});

test('saved website and sample reports reclassify old page checks whilst preserving imported runs and linked bugs', async (t) => {
  const read: PageReader = async (url) => ({
    url: url.href,
    status: 200,
    contentType: 'text/html',
    body: '<html lang="en"><title>Guide</title><body><h1>Guide</h1><img src="logo"></body></html>',
  });
  const { request, path } = await fixture(t, {}, true, undefined, read);
  const api = '/api/healthchecks';
  const imported = (await request('GET', api)).records[0] as Healthcheck;
  const current = (await request(
    'POST', api,
    {
      target_url: 'https://owned.example/',
      follow_links: false,
      browser_checks: false,
      supplied_evidence: 'PASS: A preview release check was recorded by the operator.',
      authorization_attested: true,
    },
    201,
  )).run as Healthcheck;
  const oldGroups = new Set(['core_journeys', 'access_data', 'reliability', 'usability', 'release_evidence']);
  const oldChecks = current.checks_performed!.filter((c) => c.source === 'supplied' ||
    ['Page responded successfully', 'Page has a title', 'Document language declared', 'Image missing alternative text',
      'Page content delivered', 'Main heading present'].includes(c.title)).map((c) =>
        c.title === 'Image missing alternative text' ? { ...c, category: 'usability' } : c);
  const created: Healthcheck = {
    ...current,
    checks_performed: oldChecks,
    category_scores: current.category_scores.filter((c) => oldGroups.has(c.id)).map((category) => {
      const group = oldChecks.filter((c) => c.category === category.id);
      return { ...category, total_checks: group.length, completed_checks: group.length,
        score: group.length ? Math.round(100 * group.filter((c) => c.passed).length / group.length) : 0,
        coverage: group.length ? 100 : 0, status: group.length ? 'Measured' : 'Not tested' };
    }),
    summary: 'Inspected 1 page(s). 6 checks passed, 1 failed, 0 untested.',
    readiness_indicator: 86,
  };
  const db = new DatabaseSync(path);
  try {
    const write = db.prepare('UPDATE healthchecks SET doc=? WHERE id=?');
    const readSaved = db.prepare('SELECT doc FROM healthchecks WHERE id=?');
    assert.deepEqual(JSON.parse(String(readSaved.get(imported.id)?.doc)), imported);
    for (const check_source of ['website', 'sample'] as const) {
      const legacy: Healthcheck = {
        ...created,
        check_source,
        checks_performed: created.checks_performed!.map(({ category, ...check }) => check),
        category_scores: created.category_scores.map((category) => {
          if (category.id === 'core_journeys') {
            return {
              ...category, score: 100, coverage: 100, status: 'Measured', total_checks: 1, completed_checks: 1,
            };
          }
          if (category.id === 'usability') {
            return { ...category, score: 75, total_checks: 4, completed_checks: 4 };
          }
          return category;
        }),
      };
      write.run(JSON.stringify(legacy), created.id);
      const detail = (await request('GET', api + '/' + created.id)).run as Healthcheck;
      const listed = (await request('GET', api)).records.find((r: Healthcheck) => r.id === created.id);
      assert.deepEqual(detail, { ...created, check_source });
      assert.deepEqual(listed, detail);
      assert.deepEqual(JSON.parse(String(readSaved.get(created.id)?.doc)), legacy);
    }
    const findingPath = api + '/' + created.id + '/findings/' + created.findings[0].id + '/bug';
    const converted = (await request('POST', findingPath, {})).run as Healthcheck;
    assert.deepEqual(converted.category_scores, created.category_scores);
    assert.ok(converted.findings[0].converted_bug_id);
    assert.deepEqual((await request('GET', api + '/' + created.id)).run, converted);
    assert.deepEqual((await request('GET', api + '/' + imported.id)).run, imported);
  } finally {
    db.close();
  }
});

test('concurrent website reads leave SQLite available and allocate distinct run numbers on completion', async (t) => {
  let releaseReaders!: () => void;
  let signalStarted!: () => void;
  const gate = new Promise<void>(resolve => { releaseReaders = resolve; });
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  let waiting = 0;
  const read: PageReader = async (url) => {
    if (++waiting === 2) signalStarted();
    await gate;
    return {
      url: url.href,
      status: 200,
      contentType: 'text/html',
      body: '<html lang="en"><title>Page</title><h1>Content</h1></html>',
    };
  };
  const { request } = await fixture(t, {}, false, undefined, read);
  const url = '/api/healthchecks';
  const submission = {
    authorization_attested: true,
    target_url: 'https://owned.example/',
    follow_links: false,
  };
  const inFlight = [request('POST', url, submission, 201), request('POST', url, submission, 201)];
  try {
    await started;
    await request('POST', url, submission, 429);
    const manual = await request(
      'POST',
      url,
      {
        authorization_attested: true,
        supplied_evidence:
          'PASS: The release owner completed the signed-in user journey and recorded its outcome.',
      },
      201,
    );
    assert.equal(manual.run.check_source, 'supplied');
  } finally {
    releaseReaders();
  }
  const results = await Promise.all(inFlight);
  assert.notEqual(results[0].run.healthcheck_number, results[1].run.healthcheck_number);
  assert.equal(results[0].run.inspected_pages[0].status, 200);
  const list = await request('GET', url);
  assert.equal(list.records.length, 16);
});
test('migration and seed survive reopening a persistent database; production uses secure cookies', async (t) => {
  const f = await fixture(t, { NODE_ENV: 'production' }, true);
  assert.equal(f.login.cookies[0].secure, true);
  const id = (await f.request('POST', '/api/reports', report, 201)).bug.id;
  const second = await buildApp({
    env: f.env,
    dataDir: f.dataDir,
    databasePath: f.path,
    serveClient: false,
  });
  try {
    const response = await second.inject({ url: '/api/bugs/' + id, headers: { cookie: f.admin } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().bug.id, id);
  } finally {
    await second.close();
  }
  const db = new DatabaseSync(f.path);
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM settings').get()?.n, 1);
    assert.throws(() => db.exec('UPDATE activity SET at=at'));
    const hash = db.prepare('SELECT password_hash FROM users LIMIT 1').get()?.password_hash;
    assert.notEqual(hash, f.pass);
    assert.equal(typeof hash, 'string');
  } finally {
    db.close();
  }
});

test('the external analyser produces a proposal only and a provider failure preserves the bug', async (t) => {
  let fail = false;
  const llm = createLlmAnalyser({
    apiKey: password(),
    fetch: async () => {
      if (fail) return new Response('Unavailable', { status: 503 });
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                diagnosis: 'The preview disclosure control lost its state.',
                confidence: 72,
                plan: ['Review the disclosure state and implement the owner-approved change.'],
                checks: ['Verify that the details open on activation.'],
              }),
            },
          },
        ],
      });
    },
  });
  const f = await fixture(t, {}, false, llm),
    { request } = f;
  const id = (await request('POST', '/api/reports', report, 201)).bug.id,
    path = '/api/bugs/' + id;
  const analysed = await request('POST', path + '/analyses', {});
  assert.equal(analysed.bug.analysis_engine, 'llm');
  assert.equal(analysed.bug.safety_decision, 'manual_only');
  await request('POST', path + '/repairs', { summary: 'test', checkpoint_reference: 'a' }, 409);
  await request('POST', path + '/repairs/apply-safe', {}, 409);
  fail = true;
  const failed = await request('POST', path + '/analyses', { deep: true });
  assert.equal(failed.analysis_failed, true);
  assert.equal(failed.bug.status, 'needs_manual_investigation');
  const item = await request('GET', path);
  assert.equal(item.analyses.length, 2);
  assert.equal(item.repairs.length, 0);
  assert.equal(item.bug.preview_verification_status, 'not_tested');
});

test('an analysis cannot overwrite revised evidence or a second in-flight pass', async (t) => {
  const demo = createDemoEngine();
  let release!: () => void, begun!: () => void;
  const waiting = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      begun = resolve;
    });
  const engine: DemoEngine = {
    ...demo,
    analyse: async (b, p) => {
      begun();
      await waiting;
      return demo.analyse(b, p);
    },
  };
  const { request, call, admin } = await fixture(t, {}, false, engine);
  const id = (await request('POST', '/api/reports', report, 201)).bug.id,
    path = '/api/bugs/' + id;
  const first = call('POST', path + '/analyses', {}, admin);
  await started;
  try {
    await request('POST', path + '/analyses', {}, 409);
    await request('PATCH', path, { evidence: 'Fresh evidence received while the analysis ran.' });
  } finally {
    release();
  }
  assert.equal((await first).statusCode, 409);
  const result = await request('GET', path);
  assert.equal(result.bug.revision, 2);
  assert.equal(result.analyses.length, 0);
});

test('health and workflow limits refuse unsupported changes before writing records', async (t) => {
  const { request, call, admin } = await fixture(t);
  await request('PUT', '/api/settings', { allowed_recipes: ['undeclared.recipe'] }, 403);
  await request('POST', '/api/reports', { ...report, title: 'x'.repeat(241) }, 422);
  await request('POST', '/api/reports', { ...report, evidence: 'x'.repeat(130 * 1024) }, 413);
  await request('POST', '/api/reset', {}, 404);
  await request('POST', '/api/versions', { ...versionFields, semantic_version: 'x.y.z' }, 422);
  const { version } = await request(
    'POST',
    '/api/versions',
    { ...versionFields, change_type: 'baseline' },
    201,
  );
  await request('POST', '/api/versions/' + version.id + '/release', {}, 409);
  for (let index = 0; index < 300; index++) {
    const response = await call(
      'POST',
      '/api/auth/forgot-password',
      { email: 'absent@releasegate.test' },
      admin,
    );
    assert.equal(response.statusCode, 200);
  }
  await request('POST', '/api/auth/forgot-password', { email: 'absent@releasegate.test' }, 429);
});
