import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { openStore, type Actor } from './storage';
import { authRoutes, cookieName, type AppEnvironment } from './auth';
import { ensure, HttpError, fields, textField, httpUrl, digest, type Fields } from './support';
import { EngineError, type DemoEngine, type ProposalOnlyEngine } from './engine/index';
import { metrics, newBug, prepareReport, reopenRevision, matchesSearch } from './rules';
import { workflow } from './workflow';
import { releases } from './releases';
import { prepareHealthcheck, completeHealthcheck, prepareDesktopInspection } from './healthchecks';
import { REVIEW_MS, reviewWebsite, type ReviewEvidence, type PageReader } from './health-pages';
import { readPublicPage, type PublicPage } from './health-transport';
import { loadBrowserAssets } from './health-assets';
import { discoverBrowserButtons, reviewBrowser } from './health-browser';
import { registerSample, sampleReader } from './health-sample';
import { pdfReference, renderHealthcheckPdf } from './health-pdf';
import { desktopReceiptLifetimeMs, inspectWindowsApplication, isLocalDesktopRequest } from './health-windows';
import { registerHostingJobs } from './hosting-jobs';
import { accountRules } from './accounts';
import type { AuditEvent, Bug, Healthcheck, ReportInput, Version } from '../src/api';

type Params = { id: string; findingId: string };
type Options = {
  env?: AppEnvironment;
  dataDir?: string;
  databasePath?: string;
  serveClient?: boolean;
  engine?: DemoEngine | ProposalOnlyEngine;
  readHealthPage?: PageReader;
  inspectWindows?: typeof inspectWindowsApplication;
  sendMail?: import("./mailer").SendMail;
};

function senderKeys(env: AppEnvironment) {
  const configured: unknown = JSON.parse(env.DF9_INTAKE_KEYS || '{}');
  const keys = { ...fields(configured) };
  if (env.DF9_INTAKE_KEY) keys.default = env.DF9_INTAKE_KEY;
  return Object.entries(keys).map(([name, key]) => {
    ensure(
      name.trim() && typeof key === 'string' && key.length >= 16,
      500,
      'Invalid sender key configuration.',
    );
    return { name, hash: Buffer.from(digest(key), 'hex') };
  });
}

export async function buildApp(options: Options = {}) {
  const env = options.env ?? process.env,
    dataDir = resolve(options.dataDir ?? env.DATA_DIR ?? 'data');
  const keys = senderKeys(env);
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024 });
  await app.register(cookie);
  const store = openStore(options.databasePath ?? join(dataDir, 'releasegate.sqlite'));
  app.addHook('onClose', async () => store.close());
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const status = error instanceof EngineError ? error.status : (error.statusCode ?? 500);
    reply.code(status).send({
      message: status >= 500 ? 'The release control service could not complete this request.' : error.message,
    });
  });
  app.addHook('onRequest', (req, reply, done) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    // A cookie-authenticated write must originate at this installation.
    if (req.headers.origin && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      try {
        const origin = new URL(req.headers.origin);
        if (env.PUBLIC_ORIGIN ? origin.origin !== env.PUBLIC_ORIGIN : origin.host !== req.headers.host)
          throw new Error();
      } catch {
        return done(new HttpError(403, 'This origin cannot change release records.'));
      }
    }
    done();
  });
  let requireUser;
  try {
    requireUser = await authRoutes(app, store, env, dataDir, { sendMail: options.sendMail });
  } catch (error) {
    await app.close();
    throw error;
  }
  const user = requireUser;
  const rules = accountRules(store, env);
  const staff = (actor: { role: string }) => actor.role === 'admin';
  // Self-serve accounts get their own workspace: they see and change only records they created.
  type Owned = { reported_by_id?: string | null; owner_id?: string };
  const mine = (actor: { id: string; role: string }, doc: Owned) =>
    staff(actor) || doc.reported_by_id === actor.id || doc.owner_id === actor.id;
  const ownBugs = (actor: { id: string; role: string }) => bugs().filter((b) => mine(actor, b as Owned));
  const ownVersions = (actor: { id: string; role: string }) => versions().filter((v) => mine(actor, v as Owned));
  function ownBug(actor: { id: string; role: string }, id: string) {
    const record = store.getBug(id);
    ensure(mine(actor, record.bug as Owned), 404, 'Bug record unavailable.');
    return record;
  }
  function ownVersion(actor: { id: string; role: string }, id: string) {
    ensure(mine(actor, store.version(id) as Owned), 404, 'Version unavailable.');
  }
  // Self-serve accounts only ever see the healthchecks they ran.
  const visibleRun = (actor: { id: string; role: string }, id: string) => {
    const run = store.getRun(id);
    ensure(staff(actor) || (run as { owner_id?: string }).owner_id === actor.id, 404, 'Healthcheck unavailable.');
    return run;
  };
  if (env.RELEASEGATE_NETLIFY_JOBS === 'true') registerHostingJobs(app, user);
  const flow = workflow(store, env, options.engine),
    release = releases(store, flow),
    db = store.db;
  const bugs = () => store.list<Bug>('bugs'),
    versions = () => store.list<Version>('versions');

  function reference(prefix: string) {
    const last = db.get<{ n: number | null }>(
      sql`SELECT max(CAST(substr(number,instr(number,'-')+1) AS INTEGER)) AS n FROM bugs WHERE number LIKE ${prefix + '-%'}`,
    );
    return prefix + '-' + String((last?.n ?? 0) + 1).padStart(4, '0');
  }
  function logReport(input: ReportInput, actor: Actor) {
    if (input.duplicate_candidate_id) store.getBug(input.duplicate_candidate_id);
    const bug = newBug(input, reference(store.settings().reference_prefix));
    bug.reported_by_id = actor.id;
    store.insertBug(bug);
    store.audit(actor, 'bug.created', 'BugRecord', bug.id, 'Report received.', bug);
    return bug;
  }
  function intakeActor(req: FastifyRequest) {
    const header = req.headers.authorization;
    if (!header) {
      const actor = user(req, 'own');
      return { actor, scope: 'user:' + actor.id, integration: false };
    }
    ensure(header.startsWith('Bearer '), 401, 'Invalid sender credentials.');
    const hash = Buffer.from(digest(header.slice(7)), 'hex');
    const sender = keys.find((key) => timingSafeEqual(key.hash, hash));
    ensure(sender, 401, 'Invalid sender credentials.');
    return {
      actor: { id: 'sender:' + sender.name, email: sender.name + ' integration', role: 'user' as const },
      scope: 'sender:' + sender.name,
      integration: true,
    };
  }

  app.get('/api/dashboard', (req) => {
    const actor = user(req),
      records = ownBugs(actor),
      releases = ownVersions(actor);
    return {
      user: { email: actor.email, role: actor.role },
      stats: metrics(records, releases),
      bugs: records,
      versions: releases,
    };
  });
  app.get('/api/bugs', (req) => {
    const actor = user(req);
    const query = req.query as Record<string, string>,
      limit = Number(query.limit ?? 300),
      offset = Number(query.offset ?? 0);
    ensure(
      Number.isSafeInteger(limit) && limit > 0 && limit <= 500 && Number.isSafeInteger(offset) && offset >= 0,
      422,
      'Use a limit between 1 and 500 and a non-negative offset.',
    );
    return {
      records: ownBugs(actor)
        .filter((b) => matchesSearch(b, query.q ?? ''))
        .slice(offset, offset + limit),
    };
  });
  app.get<{ Params: Params }>('/api/bugs/:id', (req) => {
    ownBug(user(req), req.params.id);
    return store.record(req.params.id);
  });
  app.get('/api/search', (req) => {
    const actor = user(req);
    const { q = '' } = req.query as { q?: string };
    ensure(typeof q === 'string', 422, 'Invalid search.');
    return {
      records: ownBugs(actor)
        .filter((b) => matchesSearch(b, q))
        .slice(0, 500),
    };
  });
  app.get('/api/notifications', (req) => {
    const actor = user(req);
    const events = store
      .list<AuditEvent>('activity')
      .filter((e) => staff(actor) || e.actor_email === actor.email)
      .slice(0, 20);
    return {
      notifications: events.map((e) => ({
        id: e.id,
        title: e.action.replaceAll('.', ' '),
        detail: e.detail,
        occurred_at: e.occurred_at,
        href: e.bug_record_id
          ? '/bugs/' + encodeURIComponent(e.bug_record_id)
          : e.entity_name === 'VersionRecord'
            ? '/versions'
            : e.action.startsWith('healthcheck.')
              ? '/healthcheck'
              : '/settings',
      })),
    };
  });

  app.post('/api/reports', async (req, reply) => {
    const { actor, scope, integration } = intakeActor(req),
      input = prepareReport(req.body);
    if (integration) input.source = 'integration';
    const key = req.headers['idempotency-key'];
    ensure(!integration || key, 422, 'An Idempotency-Key is required for a sender.');
    ensure(
      key === undefined || (typeof key === 'string' && key.trim().length > 0 && key.length <= 160),
      422,
      'Invalid Idempotency-Key.',
    );
    const hash = digest(JSON.stringify(input));
    const result = store.transaction(() => {
      const receipt = key
        ? db.get<{ bug_id: string; body_digest: string }>(
            sql`SELECT * FROM intake_receipts WHERE sender=${scope} AND request_key=${key}`,
          )
        : undefined;
      if (receipt) {
        ensure(
          receipt.body_digest === hash,
          409,
          'This idempotency key belongs to different report content.',
        );
        return { bug: store.getBug(receipt.bug_id).bug, created: false };
      }
      const bug = logReport(input, actor);
      if (key) db.run(sql`INSERT INTO intake_receipts VALUES (${scope},${key},${hash},${bug.id})`);
      return { bug, created: true };
    });
    reply.code(result.created ? 201 : 200);
    if (integration && result.bug.status === 'new') return flow.analyse(result.bug.id, actor);
    return { bug: result.bug };
  });
  app.patch<{ Params: Params }>('/api/bugs/:id', (req) => {
    const actor = user(req, 'own'),
      body = fields(req.body);
    return store.transaction(() => {
      const { bug } = store.getBug(req.params.id);
      ensure(
        actor.role === 'admin' || bug.reported_by_id === actor.id,
        403,
        'Only the reporter or an administrator can amend evidence.',
      );
      ensure(
        body.revision === undefined || body.revision === bug.revision,
        409,
        'The report was updated. Refresh and try again.',
      );
      const allowed = [
        'title',
        'description',
        'affected_module',
        'page_route',
        'environment',
        'severity',
        'actual_behavior',
        'expected_behavior',
        'reproduction_steps',
        'evidence',
        'duplicate_candidate_id',
      ];
      ensure(
        Object.keys(body).every((k) => allowed.includes(k) || k === 'revision'),
        422,
        'Only report fields may be edited.',
      );
      const update = prepareReport({
        ...bug,
        ...body,
        duplicate_candidate_id: body.duplicate_candidate_id ?? bug.duplicate_candidate_id ?? '',
      });
      if (update.duplicate_candidate_id) {
        ensure(update.duplicate_candidate_id !== bug.id, 422, 'A report cannot be its own duplicate.');
        ownBug(actor, update.duplicate_candidate_id);
      }
      if (!allowed.some((k) => k in body && update[k as keyof ReportInput] !== bug[k as keyof ReportInput]))
        return { bug };
      Object.assign(bug, update, { evidence_count: update.evidence ? 1 : 0 });
      reopenRevision(bug);
      store.saveBug(bug, {});
      store.audit(
        actor,
        'bug.evidence.updated',
        'BugRecord',
        bug.id,
        'Evidence revision ' + bug.revision + ' requires a fresh analysis.',
        bug,
      );
      return { bug };
    });
  });
  app.post<{ Params: Params }>('/api/bugs/:id/analyses', (req) => {
    const actor = user(req, 'own'),
      body = fields(req.body ?? {});
    ownBug(actor, req.params.id);
    ensure(body.deep === undefined || typeof body.deep === 'boolean', 422, 'Invalid analysis pass.');
    return flow.analyse(req.params.id, actor, body.deep === true);
  });
  function bugCommand(path: string, execute: (id: string, body: Fields, actor: Actor) => unknown) {
    app.post<{ Params: Params }>('/api/bugs/:id/' + path, (req) => {
      const actor = user(req, 'own');
      ownBug(actor, req.params.id);
      return store.transaction(() => execute(req.params.id, fields(req.body ?? {}), actor));
    });
  }
  bugCommand('repairs', flow.begin);
  bugCommand('repairs/apply-safe', (id, _body, actor) => flow.applySafe(id, actor));
  bugCommand('implementation', flow.implement);
  bugCommand('verifications', flow.verify);
  bugCommand('gate', flow.gate);
  bugCommand('reopen', (id, body, actor) => {
    const reason = textField(body, 'reason', true),
      { bug } = store.getBug(id);
    ensure(
      !['new', 'reopened', 'triage_in_progress'].includes(bug.status),
      409,
      'This report is already open for analysis.',
    );
    reopenRevision(bug);
    store.saveBug(bug, {});
    store.audit(actor, 'bug.reopened', 'BugRecord', id, reason, bug);
    return { bug };
  });
  app.get('/api/versions', (req) => {
    return { records: ownVersions(user(req, 'own')) };
  });
  app.post('/api/versions', (req, reply) => {
    const actor = user(req, 'own');
    const body = fields(req.body);
    if (!staff(actor)) {
      const linked = Array.isArray(body.linked_bug_ids) ? body.linked_bug_ids : [];
      for (const id of linked) if (typeof id === 'string') ownBug(actor, id);
    }
    reply.code(201);
    return store.transaction(() => release.create(body, actor));
  });
  app.post<{ Params: Params }>('/api/versions/:id/release', (req) => {
    const actor = user(req, 'own');
    ownVersion(actor, req.params.id);
    return store.transaction(() => release.release(req.params.id, actor));
  });
  app.post<{ Params: Params }>('/api/versions/:id/verify', (req) => {
    const actor = user(req, 'own');
    ownVersion(actor, req.params.id);
    return store.transaction(() => release.verify(req.params.id, fields(req.body), actor));
  });

  app.get('/api/settings', (req) => {
    user(req, true);
    return { config: store.settings() };
  });
  app.put('/api/settings', (req) => {
    const actor = user(req, true),
      body = fields(req.body);
    return store.transaction(() => {
      const config = store.settings();
      for (const key of ['policy_version', 'blocked_areas', 'allowed_recipes'] as const) {
        ensure(
          !(key in body) || JSON.stringify(body[key]) === JSON.stringify(config[key]),
          403,
          'The release policy cannot be edited through installation settings.',
        );
      }
      for (const key of ['app_name', 'preview_url', 'live_url', 'reference_prefix'] as const)
        if (key in body) {
          const value = textField(
            body,
            key,
            key === 'app_name' || key === 'reference_prefix',
            key === 'reference_prefix' ? 8 : 2048,
          );
          if (key === 'reference_prefix')
            ensure(
              /^[A-Z0-9]{1,8}$/.test(value),
              422,
              'Use up to eight uppercase letters or numbers for the prefix.',
            );
          config[key] = key.endsWith('_url') ? httpUrl(value) : value;
        }
      for (const key of ['automation_enabled', 'onboarding_complete'] as const)
        if (key in body) {
          const value = body[key];
          ensure(typeof value === 'boolean', 422, 'Invalid setting.');
          config[key] = value;
        }
      db.run(sql`UPDATE settings SET doc=${JSON.stringify(config)} WHERE id=1`);
      store.audit(actor, 'config.updated', 'Configuration', 'local', 'Updated the install configuration.');
      return { config };
    });
  });
  app.get('/api/audit', (req) => {
    user(req, true);
    return { events: store.list<AuditEvent>('activity') };
  });
  // First-party statistics. Visits are anonymous daily counters; see the privacy page.
  app.post('/api/stats/visit', { bodyLimit: 256 }, (req, reply) => {
    const forwarded = String(req.headers['x-nf-client-connection-ip'] ?? req.headers['x-forwarded-for'] ?? req.ip).split(',')[0].trim();
    rules.visit(forwarded + '|' + String(req.headers['user-agent'] ?? '').slice(0, 200));
    return reply.code(204).send();
  });
  app.get('/api/stats', (req) => {
    user(req, true);
    return rules.stats(30);
  });
  app.get('/api/healthchecks', (req) => {
    const actor = user(req, 'own');
    const records = store.listRuns().filter((run) => staff(actor) || (run as { owner_id?: string }).owner_id === actor.id);
    return { records, account: rules.allowance(actor) };
  });
  app.get<{ Params: Params }>('/api/healthchecks/:id', (req) => {
    return { run: visibleRun(user(req, 'own'), req.params.id) };
  });
  app.route<{ Params: Params }>({
    method: ['GET', 'HEAD'],
    url: '/api/healthchecks/:id/pdf',
    async handler(req, reply) {
      const run = visibleRun(user(req, 'own'), req.params.id);
      try {
        const pdf = req.method === 'HEAD' ? undefined : await renderHealthcheckPdf(run);
        return reply
          .type('application/pdf')
          .header('Content-Disposition', `attachment; filename="ReleaseGate-${pdfReference(run)}.pdf"`)
          .send(pdf);
      } catch {
        return reply.code(503).send({ message: 'PDF export could not finish. Check that Chromium is available and try again.' });
      }
    },
  });
  registerSample(app);
  const captures = new Map<string, { hash: string; expires: number }>();
  let picker: AbortController | undefined;
  app.addHook('onClose', async () => { picker?.abort(); });
  function captureSession(req: FastifyRequest) {
    // Only authenticated administrators reach this function.
    return digest(req.cookies[cookieName]!);
  }
  app.post('/api/healthchecks/inspect-windows', async (req, reply) => {
    user(req, true);
    ensure(isLocalDesktopRequest(req, app.server.address()), 403,
      'Use the local ReleaseGate address on the Windows PC running your application.');
    const body = fields(req.body);
    ensure(body.authorization_attested === true && Object.keys(body).length === 1, 422,
      'Confirm authorisation and choose the executable in the Windows file picker.');
    ensure(!picker, 409, 'A desktop inspection is already open. Finish or close the Windows picker first.');
    const controller = new AbortController();
    picker = controller;
    const stop = () => controller.abort();
    reply.raw.once('close', stop);
    try {
      const raw = fields(await (options.inspectWindows ?? inspectWindowsApplication)(controller.signal));
      if (raw.cancelled === true) return { cancelled: true };
      const inspection = prepareDesktopInspection({ ...raw, captured_at: new Date().toISOString() });
      const time = Date.now();
      for (const [key, item] of captures) if (item.expires <= time) captures.delete(key);
      captures.set(captureSession(req), { hash: digest(JSON.stringify(inspection)), expires: time + desktopReceiptLifetimeMs });
      return inspection;
    } finally {
      reply.raw.off('close', stop);
      picker = undefined;
    }
  });
  let activeReviews = 0;
  function beginWebsiteRead() {
    ensure(activeReviews < 2, 429, 'Two website reviews are running. Try again when one finishes.');
    activeReviews++;
  }
  function reviewTarget(input: ReturnType<typeof prepareHealthcheck>) {
    return input.sample_site
      ? sampleReader(app.server.address())
      : { start: new URL(input.target_url), read: options.readHealthPage ?? readPublicPage };
  }
  app.post('/api/healthchecks/discover-buttons', async (req) => {
    const actor = user(req, 'scan');
    const { authorization_attested, target_url, sample_site } = fields(req.body);
    const target = reviewTarget(prepareHealthcheck({ authorization_attested, target_url, sample_site }));
    ensure(!target.start.search && !target.start.hash, 422, 'Use a starting page without a query or fragment for button discovery.');
    ensure(activeReviews < 2, 429, 'Two website reviews are running. Try again when one finishes.');
    rules.consume(actor, 'discover');
    beginWebsiteRead();
    try {
      const signal = AbortSignal.timeout(REVIEW_MS);
      const page = await target.read(target.start, { signal });
      const htmlType = page.contentType.split(';')[0].trim().toLowerCase();
      ensure(!page.hadQuery && page.status >= 200 && page.status < 300 &&
        ['text/html', 'application/xhtml+xml'].includes(htmlType), 422,
        'Button discovery needs a public HTML page that loads successfully at a query-free address.');
      const {assets, limitations} = await loadBrowserAssets([page], target.read, signal);
      const discovery = await discoverBrowserButtons(page, assets);
      return { ...discovery, limitations: [...limitations, ...discovery.limitations] };
    } finally {
      activeReviews--;
    }
  });
  app.post('/api/healthchecks', async (req, reply) => {
    const actor = user(req, 'scan');
    const input = prepareHealthcheck(fields(req.body));
    if (!staff(actor)) {
      ensure(!input.desktop_inspection, 403, 'Windows desktop inspection is not available on this account.');
      ensure(activeReviews < 2, 429, 'Two website reviews are running. Try again when one finishes.');
      rules.consume(actor, 'scan');
    }
    if (input.desktop_inspection) {
      const capture = captures.get(captureSession(req));
      ensure(capture && capture.expires > Date.now() && capture.hash === digest(JSON.stringify(input.desktop_inspection)), 409,
        'Choose the .exe and inspect it again to save fresh desktop evidence in this session.');
    }
    let evidence: ReviewEvidence | undefined;
    if (input.sample_site || input.target_url) {
      beginWebsiteRead();
      try {
        const target = reviewTarget(input);
        let robots: PublicPage | undefined;
        const read: PageReader = async (url, options) => {
          if (robots?.url === url.href && !options?.signal?.aborted) return robots;
          const page = await target.read(url, options);
          if (url.pathname === '/robots.txt' && !url.search && page.url === url.href) robots = page;
          return page;
        };
        const captureDeadline = AbortSignal.timeout(REVIEW_MS);
        evidence = await reviewWebsite(
          target.start,
          input.follow_links !== false,
          read,
          captureDeadline,
          {
            environment: input.environment, maxPages: input.max_pages,
            prepareReplay: input.browser_checks ? async (pages) => {
              const limitations: string[] = [];
              let replayPages = pages.filter((page) => !page.hadQuery);
              if (target.start.search || pages[0]?.hadQuery) {
                replayPages = [];
                limitations.push('The start URL contains a query. Browser replay needs a query-free address to reproduce its location.');
              } else if (replayPages.length < pages.length) limitations.push('Query-specific linked pages were excluded from browser replay.');
              const capture = await loadBrowserAssets(replayPages, read, captureDeadline);
              return async (onRendered) => {
                const result = await reviewBrowser(replayPages, capture.assets, input.button_journeys ?? [], AbortSignal.timeout(REVIEW_MS), onRendered);
                return { checks: result.checks, limitations: [...limitations, ...capture.limitations, ...result.limitations] };
              };
            } : undefined,
          },
        );
        if (!input.browser_checks) {
          evidence.limitations.push('Browser checks were switched off. Buttons and rendered behaviour were untested.');
        }
      } finally {
        activeReviews--;
      }
    }
    reply.code(201);
    const saved = store.transaction(() => {
      const last = store
        .list<Healthcheck>('healthchecks')
        .reduce((max, r) => Math.max(max, Number(r.healthcheck_number.split('-')[1]) || 0), 0);
      const run: Healthcheck & { owner_id?: string } = completeHealthcheck(input, 'HC-' + String(last + 1).padStart(4, '0'), evidence);
      run.owner_id = actor.id;
      db.run(sql`INSERT INTO healthchecks VALUES (${run.id},${run.completed_at},${JSON.stringify(run)})`);
      store.audit(actor, 'healthcheck.completed', 'Healthcheck', run.id, run.summary);
      return { run };
    });
    if (input.desktop_inspection) captures.delete(captureSession(req));
    return saved;
  });
  app.post<{ Params: Params }>('/api/healthchecks/:id/findings/:findingId/bug', (req) => {
    const actor = user(req, 'own');
    visibleRun(actor, req.params.id);
    return store.transaction(() => {
      const run = store.getRun(req.params.id),
        finding = run.findings.find((f) => f.id === req.params.findingId);
      ensure(finding, 404, 'Finding unavailable.');
      if (finding.converted_bug_id) return { run, bug: store.getBug(finding.converted_bug_id).bug };
      const bug = logReport(
        prepareReport({
          title: finding.title,
          description: finding.observation || finding.title,
          affected_module: finding.affected_area || finding.category,
          actual_behavior: finding.observation,
          expected_behavior: finding.recommendation,
          evidence: finding.evidence_summary,
          severity: finding.severity,
          environment: run.environment,
          source: 'healthcheck',
        }),
        actor,
      );
      bug.source_healthcheck_id = run.id;
      bug.source_healthcheck_number = run.healthcheck_number;
      bug.source_check_key = finding.check_key;
      store.saveBug(bug, {});
      finding.converted_bug_id = bug.id;
      finding.converted_bug_number = bug.bug_number;
      db.run(sql`UPDATE healthchecks SET doc=${JSON.stringify(run)} WHERE id=${run.id}`);
      return { run, bug };
    });
  });
  const webRoot = resolve('dist/client');
  if (options.serveClient !== false && existsSync(join(webRoot, 'index.html'))) {
    await app.register(staticFiles, { root: webRoot, index: 'index.html' });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && req.headers.accept?.includes('text/html'))
        return reply.sendFile('index.html');
      return reply.code(404).send({ message: 'Page unavailable.' });
    });
  }
  return app;
}
