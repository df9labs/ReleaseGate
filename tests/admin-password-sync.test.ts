import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { buildApp } from '../server/app';
import { applyConfiguredAdminPassword } from '../server/apply-admin-password';

test('configured password updates only the existing administrator and keeps the next sign-in on a repeat run', async (t) => {
  const root = resolve('.work/admin-password-tests');
  mkdirSync(root, { recursive: true });
  const dataDir = mkdtempSync(join(root, 'case-'));
  const databasePath = join(dataDir, 'fixture.sqlite');
  const adminEmail = 'admin@example.test', memberEmail = 'member@example.test';
  const original = randomBytes(24).toString('hex'), replacement = randomBytes(24).toString('hex');
  const memberPassword = randomBytes(24).toString('hex');
  const app = await buildApp({ dataDir, databasePath, serveClient: false,
    env: { NODE_ENV: 'test', DEMO_ADMIN_EMAIL: adminEmail, DEMO_ADMIN_PASSWORD: original },
  });
  t.after(async () => {
    await app.close();
    if (resolve(dataDir).startsWith(root + sep)) rmSync(dataDir, { recursive: true, force: true });
  });
  const postAuth = (action: string, payload: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/auth/' + action, payload });
  const session = (cookie: string) => app.inject({ url: '/api/auth/session', headers: { cookie } });
  function cookieOf(response: Awaited<ReturnType<typeof postAuth>>) {
    const cookie = response.cookies[0];
    assert.ok(cookie);
    return cookie.name + '=' + cookie.value;
  }
  const first = await postAuth('login', { email: adminEmail, password: original });
  assert.equal(first.statusCode, 200);
  const admin = cookieOf(first);
  const created = await postAuth('register', { email: memberEmail, full_name: 'Fixture member', password: memberPassword });
  assert.equal(created.statusCode, 201);
  const member = cookieOf(created);
  const history = (cookie: string) => app.inject({ url: '/api/healthchecks', headers: { cookie } });
  const saved = await app.inject({ method: 'POST', url: '/api/healthchecks', headers: { cookie: admin }, payload: {
    authorization_attested: true,
    supplied_evidence: 'PASS: A saved fixture record remains in history after the admin credential update.',
  } });
  assert.equal(saved.statusCode, 201);
  const records = await history(admin);
  assert.equal(records.statusCode, 200);

  for (const email of [adminEmail, memberEmail])
    assert.equal((await postAuth('forgot-password', { email })).statusCode, 200);
  const outbox = join(dataDir, 'outbox');
  const tokens = new Map<string, string>();
  for (const file of readdirSync(outbox)) {
    const receipt = JSON.parse(readFileSync(join(outbox, file), 'utf8'));
    const token = new URL(receipt.path, 'https://example.test').searchParams.get('token');
    assert.ok(token);
    tokens.set(receipt.to, token);
  }
  assert.equal(tokens.size, 2);

  const absent = join(dataDir, 'absent.sqlite');
  await assert.rejects(applyConfiguredAdminPassword(absent, adminEmail, replacement));
  assert.equal(existsSync(absent), false);
  for (const [email, password] of [[memberEmail, replacement], ['absent@example.test', replacement], [adminEmail, 'short']])
    await assert.rejects(applyConfiguredAdminPassword(databasePath, email, password));
  assert.equal((await session(admin)).statusCode, 200);
  assert.equal((await session(member)).statusCode, 200);

  assert.equal(await applyConfiguredAdminPassword(databasePath, adminEmail, replacement), 'updated');
  assert.equal((await session(admin)).statusCode, 401);
  assert.equal((await postAuth('login', { email: adminEmail, password: original })).statusCode, 401);
  assert.equal((await postAuth('reset-password', { token: tokens.get(adminEmail)!, password: original })).statusCode, 422);
  assert.equal((await session(member)).statusCode, 200);
  assert.equal((await postAuth('login', { email: memberEmail, password: memberPassword })).statusCode, 200);
  assert.equal((await postAuth('reset-password', { token: tokens.get(memberEmail)!, password: memberPassword })).statusCode, 200);

  const after = await postAuth('login', { email: adminEmail, password: replacement });
  assert.equal(after.statusCode, 200);
  const fresh = cookieOf(after);
  assert.deepEqual((await history(fresh)).json(), records.json());
  assert.equal(await applyConfiguredAdminPassword(databasePath, adminEmail, replacement), 'unchanged');
  assert.equal((await session(fresh)).statusCode, 200);
});
