import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { buildApp } from '../server/app';
import { openStore } from '../server/storage';

test('new installations show Datum Foundry Nine in the authenticated demo account', async () => {
  const password = randomBytes(24).toString('base64url');
  const email = 'demo@installation.test';
  const app = await buildApp({
    env: { DEMO_ADMIN_EMAIL: email, DEMO_ADMIN_PASSWORD: password },
    databasePath: ':memory:',
    serveClient: false,
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().user.full_name, 'Datum Foundry Nine');
  } finally {
    await app.close();
  }
});

test('the upgrade renames only legacy bootstrap and target labels and preserves saved sessions', (t) => {
  const base = resolve('.work/organisation-tests');
  mkdirSync(base, { recursive: true });
  for (const [firstAdmin, target, expectedAdmin, expectedTarget] of [
    ['Polaris Sandbox', 'RuinPilotPlus', 'Datum Foundry Nine', 'RuinPilotPlus'],
    ['Polaris Craft', 'Polaris Craft', 'Datum Foundry Nine', 'Datum Foundry Nine'],
    ['Chris', 'Custom product', 'Chris', 'Custom product'],
  ]) {
    const folder = mkdtempSync(join(base, 'upgrade-'));
    t.after(() => {
      if (dirname(resolve(folder)) === base) rmSync(folder, { recursive: true, force: true });
    });
    const path = join(folder, 'legacy.sqlite');
    const legacy = new DatabaseSync(path);
    try {
      const schema = '001_release_control.sql';
      legacy.exec(readFileSync(resolve('server/migrations', schema), 'utf8'));
      legacy.exec('CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied TEXT NOT NULL)');
      legacy.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(schema, new Date().toISOString());
      const account = legacy.prepare('INSERT INTO users VALUES (?,?,?,?,?)');
      account.run('first', 'operator@installation.test', firstAdmin, 'admin', 'stored-hash');
      account.run('second', 'second@installation.test', 'Polaris Sandbox', 'admin', 'stored-hash');
      account.run('regular', 'user@installation.test', 'Polaris Craft', 'user', 'stored-hash');
      legacy
        .prepare('INSERT INTO sessions VALUES (?,?,?)')
        .run('session-digest', 'first', Date.now() + 60000);
      legacy
        .prepare('INSERT INTO settings VALUES (1,?)')
        .run(JSON.stringify({ app_name: target, reference_prefix: 'QC' }));
    } finally {
      legacy.close();
    }
    for (let startup = 0; startup < 2; startup++) {
      const store = openStore(path);
      try {
        const names = store.db.all<{ full_name: string }>(sql`SELECT full_name FROM users ORDER BY rowid`);
        assert.deepEqual(
          names.map((row) => row.full_name),
          [expectedAdmin, 'Polaris Sandbox', 'Polaris Craft'],
        );
        assert.equal(store.settings().app_name, expectedTarget);
        assert.equal(store.settings().reference_prefix, 'QC');
        assert.equal(store.db.get<{ user_id: string }>(sql`SELECT user_id FROM sessions`)?.user_id, 'first');
        assert.equal(
          store.db.get<{ password_hash: string }>(sql`SELECT password_hash FROM users WHERE id='first'`)
            ?.password_hash,
          'stored-hash',
        );
      } finally {
        store.close();
      }
    }
  }
});
