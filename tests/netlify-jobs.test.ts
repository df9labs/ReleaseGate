import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedJobResponse, usesHostedJob } from '../src/netlify-jobs';

test('hosted jobs cover the long operations and leave sign-in, Windows and list calls on their original paths', () => {
  for (const [method, path] of [
    ['POST', '/api/healthchecks'], ['POST', '/api/healthchecks/discover-buttons'],
    ['POST', '/api/bugs/1/analyses'], ['GET', '/api/healthchecks/1/pdf'],
  ]) assert.equal(usesHostedJob(method, path), true);
  for (const [method, path] of [
    ['GET', '/api/healthchecks'], ['POST', '/api/auth/login'], ['POST', '/api/healthchecks/inspect-windows'],
    ['POST', '/api/bugs/1/gate'], ['GET', 'https://elsewhere.example/api/healthchecks/1/pdf'],
  ]) assert.equal(usesHostedJob(method, path), false);
});

test('a hosted mutation submits once and polls for the original JSON status and result', async (t) => {
  const path = '/api/healthchecks';
  const payload = { authorization_attested: true, sample_site: true };
  const requests: Array<{ url: string; init: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    if (requests.length === 1) return Response.json({ id: 'job-1' }, { status: 202 });
    if (requests.length === 2) return Response.json({ pending: true }, { status: 202 });
    return Response.json({ run: { id: 'run-1' } }, { status: 201 });
  });
  const result = await hostedJobResponse(path, { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { run: { id: 'run-1' } });
  assert.deepEqual(requests.map(r => [r.init.method, r.url]), [
    ['POST', '/api/hosting/jobs'], ['GET', '/api/hosting/jobs/job-1'], ['GET', '/api/hosting/jobs/job-1'],
  ]);
  assert.deepEqual(JSON.parse(requests[0].init.body as string), { method: 'POST', path, body: payload });
  assert.ok(requests.every(r => r.init.credentials === 'same-origin' && r.init.cache === 'no-store'));
});

test('the hosted PDF keeps the binary response, its filename and content type', async (t) => {
  const pdf = Uint8Array.of(37, 80, 68, 70, 45, 255, 0);
  const disposition = 'attachment; filename="ReleaseGate-HC-1001.pdf"';
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      assert.deepEqual(JSON.parse(init.body as string), { method: 'GET', path: '/api/healthchecks/1/pdf' });
      return Response.json({ id: 'PDF' }, { status: 202 });
    }
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition } });
  });
  const result = await hostedJobResponse('/api/healthchecks/1/pdf', { headers: { Accept: 'application/pdf' } });
  assert.equal(result.headers.get('Content-Disposition'), disposition);
  assert.equal(result.headers.get('Content-Type'), 'application/pdf');
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), pdf);
});

test('failed submissions and missing results reach the caller without repeating the work', async (t) => {
  const path = '/api/bugs/1/analyses';
  const errors = [Response.json({ message: 'Busy' }, { status: 429 }), Response.json({ id: 'gone' }, { status: 202 }),
    Response.json({ message: 'Result expired' }, { status: 404 })];
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls.push(options.method!);
    return errors.shift()!;
  });
  const busy = await hostedJobResponse(path, { method: 'POST' });
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).message, 'Busy');
  const expired = await hostedJobResponse(path, { method: 'POST' });
  assert.equal(expired.status, 404);
  assert.equal((await expired.json()).message, 'Result expired');
  assert.deepEqual(calls, ['POST', 'POST', 'GET']);
});

test('hosted transport reports a misrouted HTML response and rejects an unusable job reference', async (t) => {
  const responses = [new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }),
    Response.json({ id: '../login' }, { status: 202 })];
  t.mock.method(globalThis, 'fetch', async () => responses.shift());
  await assert.rejects(hostedJobResponse('/api/healthchecks', { method: 'POST' }), /web page for an API request/);
  await assert.rejects(hostedJobResponse('/api/healthchecks', { method: 'POST' }), /invalid job reference/);
});

test('aborting button discovery stops polling without retrying the submission', async (t) => {
  const controller = new AbortController();
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls.push(init.method!);
    assert.equal(init.signal, controller.signal);
    if (init.method === 'POST') return Response.json({ id: 'pending' }, { status: 202 });
    setTimeout(() => controller.abort(), 5);
    return Response.json({ pending: true }, { status: 202 });
  });
  await assert.rejects(hostedJobResponse('/api/healthchecks/discover-buttons', { method: 'POST', signal: controller.signal }),
    (error: Error) => error.name === 'AbortError');
  assert.deepEqual(calls, ['POST', 'GET']);
});
