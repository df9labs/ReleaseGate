import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { User } from '../src/api';
import { organisationName } from '../src/organisation';
import type { Store } from './storage';
import { digest, ensure, fields, textField, uid } from './support';
import { hashPassword, matchesPassword, passwordValue } from './passwords';
import { accountRules } from './accounts';
import { mailer, type SendMail } from './mailer';

const sessionAge = 7 * 24 * 60 * 60;
const resetAge = 30 * 60_000;
const verifyAge = 48 * 60 * 60_000;
const ipAttemptLimit = 300;
const loginFailureLimit = 10;
export const cookieName = 'releasegate_session';
export type AppEnvironment = Record<string, string | undefined>;

function emailAddress(body: ReturnType<typeof fields>) {
  const email = textField(body, 'email', true, 254).toLowerCase();
  ensure(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 422, 'Enter a valid email address.');
  return email;
}
function publicUser(user: User): User {
  return { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
}
export async function authRoutes(
  app: FastifyInstance,
  store: Store,
  env: AppEnvironment,
  dataDir: string,
  options: { sendMail?: SendMail } = {},
) {
  const { db } = store;
  const production = env.NODE_ENV === 'production';
  const rules = accountRules(store, env);
  const sendMail = options.sendMail ?? mailer(env);
  const origin = (env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  if (!db.get(sql`SELECT id FROM users WHERE role='admin' LIMIT 1`)) {
    const password = passwordValue(env.DEMO_ADMIN_PASSWORD);
    const email = emailAddress({ email: env.DEMO_ADMIN_EMAIL || 'admin@releasegate.local' });
    const hashed = await hashPassword(password);
    store.transaction(() => {
      if (!db.get(sql`SELECT id FROM users WHERE role='admin' LIMIT 1`)) {
        ensure(
          !db.get(sql`SELECT id FROM users WHERE email=${email}`),
          409,
          'The configured administrator email already belongs to another account.',
        );
        db.run(sql`INSERT INTO users VALUES (${uid()},${email},${organisationName},'admin',${hashed})`);
      }
    });
  }
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  /**
   * `true` requires an administrator. `'own'` also admits a self-serve account (for reading its own records);
   * `'scan'` additionally requires that account's email to be confirmed when email is switched on.
   */
  function requireUser(req: FastifyRequest, admin: boolean | 'scan' | 'own' = false) {
    const token = req.cookies[cookieName];
    ensure(token, 401, 'Please sign in.');
    const user = db.get<User>(
      sql`SELECT u.id,u.email,u.full_name,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.digest=${digest(token)} AND s.expires>${Date.now()}`,
    );
    ensure(user, 401, 'Please sign in.');
    if ((admin === 'scan' || admin === 'own') && user.role !== 'admin') {
      ensure(user.role === 'user', 403, 'Administrator access is required.');
      if (admin === 'scan')
        ensure(rules.verified(user), 403, 'Confirm your email address to run scans. Check your inbox for the link.');
    } else ensure(!admin || user.role === 'admin', 403, 'Administrator access is required.');
    return user;
  }
  function startSession(req: FastifyRequest, reply: FastifyReply, user: User) {
    const token = randomBytes(32).toString('base64url');
    const old = req.cookies[cookieName];
    if (old) db.run(sql`DELETE FROM sessions WHERE digest=${digest(old)}`);
    db.run(sql`DELETE FROM sessions WHERE expires<=${Date.now()}`);
    db.run(
      sql`INSERT INTO sessions VALUES (${digest(token)},${user.id},${Date.now() + sessionAge * 1000})`,
    );
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: production,
      path: '/',
      maxAge: sessionAge,
    });
    return { user: publicUser(user) };
  }
  function throttle(req: FastifyRequest) {
    const key = digest(req.ip + ':' + req.routeOptions.url);
    const cutoff = Date.now() - 15 * 60_000;
    const count = store.transaction(() => {
      db.run(sql`DELETE FROM attempts WHERE since<=${cutoff}`);
      db.run(
        sql`INSERT INTO attempts VALUES (${key},${Date.now()},1) ON CONFLICT(bucket) DO UPDATE SET count=count+1`,
      );
      return db.get<{ count: number }>(sql`SELECT count FROM attempts WHERE bucket=${key}`)!.count;
    });
    ensure(count <= ipAttemptLimit, 429, 'Too many attempts. Try again later.');
  }
  // Every visitor shares one source address behind the proxy, so failed sign-ins are also limited per account.
  function loginFailures(email: string, add: boolean) {
    const key = digest('login:' + email), cutoff = Date.now() - 15 * 60_000;
    return store.transaction(() => {
      db.run(sql`DELETE FROM attempts WHERE since<=${cutoff}`);
      if (add)
        db.run(sql`INSERT INTO attempts VALUES (${key},${Date.now()},1) ON CONFLICT(bucket) DO UPDATE SET count=count+1`);
      return db.get<{ count: number }>(sql`SELECT count FROM attempts WHERE bucket=${key}`)?.count ?? 0;
    });
  }
  function issueToken(table: 'verifications' | 'recoveries', userId: string, age: number) {
    const token = randomBytes(32).toString('base64url');
    store.transaction(() => {
      if (table === 'verifications') {
        db.run(sql`DELETE FROM verifications WHERE user_id=${userId} OR expires<=${Date.now()}`);
        db.run(sql`INSERT INTO verifications VALUES (${digest(token)},${userId},${Date.now() + age})`);
      } else {
        db.run(sql`DELETE FROM recoveries WHERE user_id=${userId} OR expires<=${Date.now()}`);
        db.run(sql`INSERT INTO recoveries VALUES (${digest(token)},${userId},${Date.now() + age})`);
      }
    });
    return token;
  }
  async function sendVerification(user: User) {
    if (!sendMail || !rules.mailAllowed()) return false;
    const token = issueToken('verifications', user.id, verifyAge);
    try {
      rules.count('mail');
      await sendMail({
        to: user.email,
        subject: 'Confirm your ReleaseGate account',
        text: `Hi ${user.full_name},\n\nConfirm your email address to start running free website checks:\n${origin}/verify-email?token=${token}\n\nThe link works for 48 hours. If you didn't sign up, ignore this email.\n\nReleaseGate by DF9 Labs`,
      });
      return true;
    } catch {
      return false;
    }
  }
  app.get('/api/auth/session', (req) => {
    const user = requireUser(req);
    return { user, account: rules.allowance(user) };
  });
  app.post('/api/auth/login', async (req, reply) => {
    throttle(req);
    const body = fields(req.body),
      email = emailAddress(body);
    const password = body.password;
    const known = db.get<{ role: string }>(sql`SELECT role FROM users WHERE email=${email}`);
    // The administrator's password is long and random; locking it would only let strangers lock the operator out.
    if (known?.role !== 'admin')
      ensure(loginFailures(email, false) < loginFailureLimit, 429,
        'Too many failed sign-ins for this account. Wait 15 minutes or reset your password.');
    ensure(
      typeof password === 'string' && password.length <= 128,
      401,
      'Email or password is incorrect.',
    );
    const row = db.get<User & { password_hash: string }>(sql`SELECT * FROM users WHERE email=${email}`);
    const valid = await matchesPassword(password, row?.password_hash ?? dummyHash);
    if ((!row || !valid) && known?.role !== 'admin') loginFailures(email, true);
    ensure(row && valid, 401, 'Email or password is incorrect.');
    return store.transaction(() => {
      ensure(
        db.get(sql`SELECT id FROM users WHERE id=${row.id} AND password_hash=${row.password_hash}`),
        401,
        'Email or password is incorrect.',
      );
      return startSession(req, reply, row);
    });
  });
  app.post('/api/auth/register', async (req, reply) => {
    throttle(req);
    const body = fields(req.body),
      email = emailAddress(body);
    const name = textField(body, 'full_name', true, 120),
      password = passwordValue(body.password);
    const hash = await hashPassword(password);
    const user: User = { id: uid(), email, full_name: name, role: 'user' };
    const session = store.transaction(() => {
      ensure(
        !db.get(sql`SELECT id FROM users WHERE email=${email}`),
        409,
        'Unable to register this address.',
      );
      db.run(sql`INSERT INTO users VALUES (${user.id},${email},${name},'user',${hash})`);
      reply.code(201);
      return startSession(req, reply, user);
    });
    rules.count('signup');
    const sent = rules.mailEnabled ? await sendVerification(user) : false;
    return { ...session, account: rules.allowance(user), verification_sent: sent };
  });
  app.post('/api/auth/verify-email', (req) => {
    throttle(req);
    const token = textField(fields(req.body), 'token', true, 128);
    return store.transaction(() => {
      const row = db.get<{ user_id: string }>(
        sql`SELECT user_id FROM verifications WHERE digest=${digest(token)} AND expires>${Date.now()}`,
      );
      ensure(row, 422, 'This confirmation link is invalid or has expired. Sign in and ask for a new one.');
      db.run(sql`INSERT INTO verified_users VALUES (${row.user_id},${Date.now()}) ON CONFLICT(user_id) DO NOTHING`);
      db.run(sql`DELETE FROM verifications WHERE user_id=${row.user_id}`);
      rules.count('verified');
      return { message: 'Email confirmed. You can now run scans.' };
    });
  });
  app.post('/api/auth/resend-verification', async (req) => {
    throttle(req);
    const user = requireUser(req);
    ensure(rules.mailEnabled && !rules.verified(user), 409, 'This account does not need confirming.');
    const pending = db.get<{ expires: number }>(sql`SELECT expires FROM verifications WHERE user_id=${user.id}`);
    ensure(!pending || pending.expires - verifyAge < Date.now() - 2 * 60_000, 429,
      'We sent a link less than two minutes ago. Check your inbox and spam folder.');
    ensure(await sendVerification(user), 503, 'The confirmation email could not be sent. Try again shortly.');
    return { message: 'A new confirmation link is on its way.' };
  });
  app.post('/api/auth/logout', (req, reply) => {
    const token = req.cookies[cookieName];
    if (token) db.run(sql`DELETE FROM sessions WHERE digest=${digest(token)}`);
    return reply
      .clearCookie(cookieName, { path: '/', sameSite: 'strict', secure: production, httpOnly: true })
      .code(204)
      .send();
  });
  app.post('/api/auth/forgot-password', async (req) => {
    throttle(req);
    const email = emailAddress(fields(req.body));
    const user = db.get<User>(sql`SELECT id,email,full_name,role FROM users WHERE email=${email}`);
    if (user && sendMail && user.role !== 'admin' && rules.mailAllowed()) {
      rules.count('mail');
      const token = issueToken('recoveries', user.id, resetAge);
      await sendMail({
        to: user.email,
        subject: 'Reset your ReleaseGate password',
        text: `Hi ${user.full_name},\n\nUse this link to choose a new password. It works for 30 minutes:\n${origin}/reset-password?token=${token}\n\nIf you didn't ask for this, ignore this email.\n\nReleaseGate by DF9 Labs`,
      }).catch(() => undefined);
    } else if (user && !production) {
      const token = randomBytes(32).toString('base64url');
      store.transaction(() => {
        db.run(sql`DELETE FROM recoveries WHERE user_id=${user.id} OR expires<=${Date.now()}`);
        db.run(
          sql`INSERT INTO recoveries VALUES (${digest(token)},${user.id},${Date.now() + resetAge})`,
        );
        const outbox = join(dataDir, 'outbox');
        mkdirSync(outbox, { recursive: true, mode: 0o700 });
        writeFileSync(
          join(outbox, uid() + '.json'),
          JSON.stringify({ to: email, path: '/reset-password?token=' + token }),
          { mode: 0o600, flag: 'wx' },
        );
      });
    }
    return {
      message: sendMail
        ? 'If that address has an account, a reset link is on its way.'
        : 'If the address is eligible, recovery instructions will be available through your administrator.',
    };
  });
  app.post('/api/auth/reset-password', async (req) => {
    throttle(req);
    const body = fields(req.body),
      token = textField(body, 'token', true, 128);
    const hash = await hashPassword(passwordValue(body.password));
    return store.transaction(() => {
      const row = db.get<{ user_id: string }>(
        sql`SELECT user_id FROM recoveries WHERE digest=${digest(token)} AND expires>${Date.now()}`,
      );
      ensure(row, 422, 'The recovery link is invalid or has expired.');
      db.run(sql`UPDATE users SET password_hash=${hash} WHERE id=${row.user_id}`);
      db.run(sql`DELETE FROM recoveries WHERE user_id=${row.user_id}`);
      db.run(sql`DELETE FROM sessions WHERE user_id=${row.user_id}`);
      return { message: 'Password updated. Please sign in.' };
    });
  });
  return requireUser;
}
export type RequireUser = Awaited<ReturnType<typeof authRoutes>>;
