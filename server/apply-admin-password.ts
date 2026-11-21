import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, matchesPassword, passwordValue } from './passwords';
import { ensure } from './support';

/** Operator-only command. Use the existing volume and the configured administrator's exact account. */
export async function applyConfiguredAdminPassword(databasePath: string, email: string, password: string): Promise<'updated' | 'unchanged'> {
  passwordValue(password);
  ensure(email.trim(), 422, 'Set DEMO_ADMIN_EMAIL to the existing administrator login.');
  ensure(existsSync(databasePath), 404, 'Existing ReleaseGate database missing. Check the app service and its data volume.');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const account = db.prepare("SELECT id, password_hash FROM users WHERE email=? AND role='admin'").get(email.trim());
    ensure(account && typeof account.password_hash === 'string', 404, 'No existing administrator matches DEMO_ADMIN_EMAIL.');
    const oldHash = account.password_hash;
    const nextHash = await matchesPassword(password, oldHash) ? oldHash : await hashPassword(password);
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = db.prepare("SELECT 1 FROM users WHERE id=? AND email=? AND role='admin' AND password_hash=?")
        .get(account.id, email.trim(), oldHash);
      ensure(current, 409, 'The administrator account changed during the operation. Check its configuration and try again.');
      if (nextHash !== oldHash) {
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(nextHash, account.id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);
        db.prepare('DELETE FROM recoveries WHERE user_id=?').run(account.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return nextHash === oldHash ? 'unchanged' : 'updated';
  } finally {
    db.close();
  }
}
