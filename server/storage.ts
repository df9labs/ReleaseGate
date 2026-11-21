import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { sql, type SQL } from 'drizzle-orm';
import type {
  Analysis,
  AuditEvent,
  Bug,
  BugRecord,
  Healthcheck,
  Repair,
  Settings,
  User,
  Verification,
  Version,
} from '../src/api';
import type { PreviewChange, Proof, Proposal } from './engine/index';
import { ensure, now, uid } from './support';
import { withLocalCheckCategories } from './healthchecks';

export type Actor = Pick<User, 'id' | 'email' | 'role'>;
export type Work = {
  proposal?: Proposal;
  change?: PreviewChange;
  proof?: Proof;
  analysisTicket?: string;
  gate?: {
    route: 'automatic' | 'human';
    approved: boolean;
    receipt: string;
    revision: number;
    reason: string;
  };
};
type HistoryKind = 'analysis' | 'repair' | 'verification' | 'gate';
type ListTable = 'versions' | 'healthchecks' | 'activity' | 'bugs';

export function openStore(databasePath: string) {
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const db = drizzle({ client: sqlite });
  function transaction<T>(fn: () => T) {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      if (result instanceof Promise) throw new Error('A SQLite write transaction must be synchronous.');
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  const migrations = resolve('server/migrations');
  transaction(() => {
    sqlite.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied TEXT NOT NULL)',
    );
    for (const name of readdirSync(migrations)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (db.get(sql`SELECT name FROM schema_migrations WHERE name=${name}`)) continue;
      sqlite.exec(readFileSync(resolve(migrations, name), 'utf8'));
      db.run(sql`INSERT INTO schema_migrations VALUES (${name},${now()})`);
    }
  });

  function docs<T>(query: SQL): T[] {
    return db.all<{ doc: string }>(query).map((row) => JSON.parse(row.doc) as T);
  }
  function document<T>(query: SQL): T | undefined {
    const row = db.get<{ doc: string }>(query);
    return row && (JSON.parse(row.doc) as T);
  }
  function list<T>(table: ListTable): T[] {
    const date = table === 'bugs' ? 'updated' : 'at';
    return docs<T>(
      sql`SELECT doc FROM ${sql.identifier(table)} ORDER BY ${sql.identifier(date)} DESC, rowid DESC`,
    );
  }
  function getBug(id: string) {
    const row = db.get<{ doc: string; work: string }>(sql`SELECT doc,work FROM bugs WHERE id=${id}`);
    ensure(row, 404, 'Bug record unavailable.');
    return { bug: JSON.parse(row.doc) as Bug, work: JSON.parse(row.work) as Work };
  }
  function insertBug(bug: Bug) {
    db.run(
      sql`INSERT INTO bugs (id,number,updated,doc) VALUES (${bug.id},${bug.bug_number},${bug.updated_date},${JSON.stringify(bug)})`,
    );
  }
  function saveBug(bug: Bug, work: Work) {
    bug.updated_date = now();
    db.run(
      sql`UPDATE bugs SET updated=${bug.updated_date},doc=${JSON.stringify(bug)},work=${JSON.stringify(work)} WHERE id=${bug.id}`,
    );
  }
  function history<T>(id: string, kind: HistoryKind) {
    return docs<T>(
      sql`SELECT doc FROM bug_history WHERE bug_id=${id} AND kind=${kind} ORDER BY at DESC,rowid DESC`,
    );
  }
  function addHistory<T extends { id: string }>(id: string, kind: HistoryKind, record: T, at = now()) {
    db.run(
      sql`INSERT INTO bug_history VALUES (${record.id},${id},${kind},${at},${JSON.stringify(record)})`,
    );
  }
  function activity(event: AuditEvent) {
    db.run(
      sql`INSERT INTO activity VALUES (${event.id},${event.bug_record_id || null},${event.occurred_at},${JSON.stringify(event)})`,
    );
  }
  function audit(
    actor: Actor,
    action: string,
    entity: string,
    recordId: string,
    detail: string,
    bug?: Bug,
  ) {
    activity({
      id: uid(),
      action,
      entity_name: entity,
      record_id: recordId,
      detail,
      occurred_at: now(),
      actor_email: actor.email,
      actor_role: actor.role,
      bug_record_id: bug?.id,
      bug_number: bug?.bug_number,
    });
  }
  function record(id: string): BugRecord {
    return {
      bug: getBug(id).bug,
      analyses: history<Analysis>(id, 'analysis'),
      repairs: history<Repair>(id, 'repair'),
      verifications: history<Verification>(id, 'verification'),
      activity: docs<AuditEvent>(
        sql`SELECT doc FROM activity WHERE bug_id=${id} ORDER BY at DESC,rowid DESC`,
      ),
    };
  }
  function settings() {
    const config = document<Settings>(sql`SELECT doc FROM settings WHERE id=1`);
    ensure(config, 500, 'Install configuration missing.');
    return config;
  }
  function getRun(id: string) {
    const run = document<Healthcheck>(sql`SELECT doc FROM healthchecks WHERE id=${id}`);
    ensure(run, 404, 'Healthcheck unavailable.');
    return withLocalCheckCategories(run);
  }
  function listRuns() {
    return list<Healthcheck>('healthchecks').map(withLocalCheckCategories);
  }
  function version(id: string) {
    const value = document<Version>(sql`SELECT doc FROM versions WHERE id=${id}`);
    ensure(value, 404, 'Version unavailable.');
    return value;
  }
  function seed() {
    transaction(() => {
      if (db.get(sql`SELECT id FROM settings WHERE id=1`)) return;
      const seed = JSON.parse(readFileSync(resolve('server/seed/demo.json'), 'utf8')) as {
        settings: Settings;
        record: BugRecord;
        healthchecks: Healthcheck[];
        audit: AuditEvent[];
      };
      db.run(sql`INSERT INTO settings VALUES (1,${JSON.stringify(seed.settings)})`);
      const { bug, analyses } = seed.record;
      insertBug({ ...bug, revision: 1 });
      for (const analysis of analyses) addHistory(bug.id, 'analysis', analysis, analysis.analyzed_at);
      for (const run of seed.healthchecks)
        db.run(
          sql`INSERT INTO healthchecks VALUES (${run.id},${run.completed_at},${JSON.stringify(run)})`,
        );
      const events = new Map([...seed.audit, ...seed.record.activity].map((e) => [e.id, e]));
      for (const event of events.values())
        activity({ ...event, bug_record_id: event.bug_record_id === bug.id ? bug.id : null });
    });
  }
  seed();
  return {
    db,
    transaction,
    docs,
    list,
    getBug,
    insertBug,
    saveBug,
    history,
    addHistory,
    audit,
    record,
    settings,
    getRun,
    listRuns,
    version,
    close: () => sqlite.close(),
  };
}
export type Store = ReturnType<typeof openStore>;
