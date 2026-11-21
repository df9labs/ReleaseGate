import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { User } from '../src/api';
import type { Store } from './storage';
import { ensure } from './support';

export type AppEnvironment = Record<string, string | undefined>;
export type ScanKind = 'scan' | 'discover';

function whole(value: string | undefined, fallback: number) {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

/** Self-serve account rules. Administrators are never limited by these allowances. */
export function accountRules(store: Store, env: AppEnvironment) {
  const { db } = store;
  const limits = {
    scansPerUser: whole(env.PUBLIC_SCANS_PER_USER_DAILY, 5),
    scansTotal: whole(env.PUBLIC_SCANS_TOTAL_DAILY, 50),
    discoveriesPerUser: whole(env.PUBLIC_DISCOVERIES_PER_USER_DAILY, 10),
    mailDaily: whole(env.MAIL_DAILY_LIMIT, 90),
  };
  const mailEnabled = Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
  const day = () => new Date().toISOString().slice(0, 10);
  const used = (bucket: string) =>
    db.get<{ count: number }>(sql`SELECT count FROM scan_usage WHERE day=${day()} AND bucket=${bucket}`)?.count ?? 0;

  function verified(user: Pick<User, 'id' | 'role'>) {
    return user.role === 'admin' || !mailEnabled ||
      Boolean(db.get(sql`SELECT user_id FROM verified_users WHERE user_id=${user.id}`));
  }
  function allowance(user: Pick<User, 'id' | 'role'>) {
    if (user.role === 'admin') return { unlimited: true as const };
    const scans = used('user:' + user.id);
    return {
      unlimited: false as const,
      scans_used: scans,
      scans_limit: limits.scansPerUser,
      scans_remaining: Math.max(0, Math.min(limits.scansPerUser - scans, limits.scansTotal - used('total'))),
      verified: verified(user),
      verification_required: mailEnabled,
    };
  }
  /** Reserve one unit before work starts. A failed scan still counts, which keeps retries bounded. */
  function consume(user: Pick<User, 'id' | 'role'>, kind: ScanKind) {
    if (user.role === 'admin') return;
    const today = day();
    const refuse = (message: string) => { count('cap_hit'); ensure(false, 429, message); };
    if (kind === 'scan') {
      if (used('user:' + user.id) >= limits.scansPerUser)
        refuse(`You've used today's ${limits.scansPerUser} free scans. Your allowance resets at midnight UTC.`);
      if (used('total') >= limits.scansTotal)
        refuse("ReleaseGate has reached today's limit for free scans. Please try again tomorrow.");
    } else if (used('discover:' + user.id) >= limits.discoveriesPerUser)
      refuse(`You've used today's ${limits.discoveriesPerUser} button discoveries. They reset at midnight UTC.`);
    store.transaction(() => {
      const buckets = kind === 'scan' ? ['user:' + user.id, 'total'] : ['discover:' + user.id];
      for (const bucket of buckets)
        db.run(sql`INSERT INTO scan_usage VALUES (${today},${bucket},1) ON CONFLICT(day,bucket) DO UPDATE SET count=count+1`);
      db.run(sql`DELETE FROM scan_usage WHERE day<${today}`);
      count(kind === 'scan' ? 'scan' : 'discovery');
    });
  }
  // Statistics: daily counters only. Unique visitors use a salted hash held in memory for one UTC day.
  function count(metric: string) {
    db.run(sql`INSERT INTO stats_daily VALUES (${day()},${metric},1) ON CONFLICT(day,metric) DO UPDATE SET count=count+1`);
  }
  let visitorDay = '', visitorSalt = randomBytes(16), visitors = new Set<string>();
  function visit(source: string) {
    if (visitorDay !== day()) { visitorDay = day(); visitorSalt = randomBytes(16); visitors = new Set(); }
    count('visit');
    const key = createHash('sha256').update(visitorSalt).update(source).digest('base64url');
    if (!visitors.has(key) && visitors.size < 100_000) { visitors.add(key); count('visitor'); }
  }
  function stats(days = 30) {
    const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const rows = db.all<{ day: string; metric: string; count: number }>(
      sql`SELECT day, metric, count FROM stats_daily WHERE day>=${since} ORDER BY day`);
    const total = (query: ReturnType<typeof sql>) => db.get<{ n: number }>(query)?.n ?? 0;
    return {
      since, rows,
      accounts: total(sql`SELECT count(*) AS n FROM users WHERE role='user'`),
      verified_accounts: total(sql`SELECT count(*) AS n FROM verified_users`),
      scans_all_time: total(sql`SELECT count(*) AS n FROM healthchecks`),
      limits, verification_required: mailEnabled,
    };
  }
  /** Resend's free plan allows 100 emails a day; stay under it. */
  function mailAllowed() {
    return (db.get<{ count: number }>(sql`SELECT count FROM stats_daily WHERE day=${day()} AND metric='mail'`)?.count ?? 0) < limits.mailDaily;
  }
  return { limits, mailEnabled, verified, allowance, consume, count, visit, stats, mailAllowed };
}
export type AccountRules = ReturnType<typeof accountRules>;
