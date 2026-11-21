import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import type { Check, RenderObserver, ReviewEvidence } from './health-pages';
import { healthReadLimits, isFontType, isScriptType, trustedAssetHosts, trustedAssetOrigin, type PublicPage } from './health-transport';
import type { BrowserAsset } from './health-assets';
import { collectButtons, describeControls, sameControl, visibleControls, watchControl, type Control } from './health-controls';
import { inspectBrowserAccess } from './health-browser-access';
import type { ButtonDiscovery, DiscoveredButton } from '../src/api';
import { digest, HttpError } from './support';

export type { BrowserAsset } from './health-assets';
type Assets = ReadonlyMap<string, BrowserAsset>;
type Journey = { button: string; expected_text: string };
type HtmlPage = PublicPage & { contentSecurityPolicy?: string };
type Evidence = Pick<ReviewEvidence, 'checks' | 'limitations'>;
type Verdict = { passed: boolean | null; detail: string };
type Inventory = Awaited<ReturnType<typeof collectButtons>>;

export const browserReviewLimits = {
  launchMs: 8000,
  loadMs: 5000,
  actionMs: 2000,
  settleMs: 250,
  reviewMs: 75_000,
  detailedButtons: 100,
  automaticJourneys: 8,
  exampleNames: 5,
  labelLength: 80,
} as const;

// The original response policy is also applied. Forms, popups, nested documents and
// network connections are outside the scope of a captured-page replay.
const assetSources = trustedAssetHosts.map((host) => 'https://' + host).join(' ');
const replayPolicy = [
  'sandbox allow-scripts allow-same-origin',
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' " + assetSources,
  "style-src 'self' 'unsafe-inline' " + assetSources,
  "font-src 'self' " + assetSources,
  'img-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
].join('; ');

function result(passed: boolean | null, detail: string): Verdict {
  return { passed, detail };
}

function cssString(text: string) {
  return '"' + Array.from(text, (c) => '\\' + c.codePointAt(0)!.toString(16) + ' ').join('') + '"';
}

type Replay = {
  page: Page;
  errors: { count: number; first: string };
  blocked: Set<string>;
};

type ReplayHosts = { loaded: Set<string>; blocked: Set<string> };
const dependencyTypes = new Set(['document', 'stylesheet', 'script', 'font', 'xhr', 'fetch', 'websocket', 'eventsource', 'ping']);
const directiveTypes: Record<string, string> = {
  'script-src': 'script', 'style-src': 'stylesheet', 'font-src': 'font', 'connect-src': 'connection',
  'form-action': 'form', 'frame-src': 'document', 'worker-src': 'worker', 'child-src': 'child resource',
};

function hostNotes(hosts: ReplayHosts) {
  const notes: string[] = [];
  if (hosts.loaded.size) notes.push('The signed-out replay loaded third-party assets from ' + [...hosts.loaded].sort().join(', ') + '.');
  if (hosts.blocked.size) notes.push('The signed-out replay blocked requests to ' + [...hosts.blocked].sort().join(', ') + '.');
  return notes;
}

// Only one initial document is supplied. Element requests can use captured bytes.
// Fetch/XHR cannot read even those files.
async function inReplay<T>(
  browser: Browser,
  html: HtmlPage,
  assets: Assets,
  action: (replay: Replay) => Promise<T>,
  hosts: ReplayHosts,
): Promise<T> {
  const context = await browser.newContext({
    offline: true,
    serviceWorkers: 'block',
    acceptDownloads: false,
    permissions: [],
    viewport: { width: 1280, height: 800 },
  });
  try {
    context.setDefaultTimeout(browserReviewLimits.actionMs);
    await context.addInitScript(() => {
      // Peer connections have their own transports, independent of fetch interception.
      for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport'])
        Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
    });
    const page = await context.newPage();
    const origin = new URL(html.url).origin;
    const blocked = new Set<string>(),
      errors = { count: 0, first: '' };
    function recordBlocked(rawUrl: string | undefined, type?: string) {
      const url = rawUrl ? URL.parse(rawUrl) : null;
      const host = url && ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ? url.hostname : '';
      if (host) hosts.blocked.add(host);
      if (type) blocked.add(host ? type + ' on ' + host : type);
    }
    // CSP can reject a URL before Playwright receives a routable request.
    const audit = await context.newCDPSession(page);
    audit.on('Audits.issueAdded', ({ issue }) => {
      const policy = issue.details.contentSecurityPolicyIssueDetails;
      if (!policy || policy.isReportOnly) return;
      const directive = policy.violatedDirective.split(/\s+/)[0].replace(/-(?:elem|attr)$/, '');
      recordBlocked(policy.blockedURL, directiveTypes[directive]);
    });
    await audit.send('Audits.enable');
    page.on('requestfinished', (request) => {
      const url = new URL(request.url());
      url.hash = '';
      if (assets.has(url.href) && url.origin !== origin && trustedAssetOrigin(url) &&
        ['script', 'stylesheet', 'font'].includes(request.resourceType())) hosts.loaded.add(url.hostname);
    });
    page.on('requestfailed', (request) => {
      const type = request.resourceType();
      recordBlocked(request.url(), dependencyTypes.has(type) ? type : undefined);
    });
    page.on('pageerror', (error) => {
      // Exception messages and stacks can contain the site's data.
      errors.count++;
      if (!errors.first)
        errors.first = ['TypeError', 'RangeError', 'ReferenceError', 'SyntaxError'].includes(error.name)
          ? error.name
          : 'Error';
    });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (
        /violates .*?(connect-src|script-src|style-src|font-src|form-action|frame-src|worker-src)|blocked form submission|blocked opening.*sandbox|refused to (connect|execute|apply|frame)|blocked by CORS policy|valid digest in the 'integrity'/i.test(
          text,
        )
      )
        blocked.add('restricted resource or action');
    });
    page.on('dialog', (dialog) => {
      blocked.add('dialog');
      void dialog.dismiss().catch(() => {});
    });
    context.on('page', (other) => {
      if (other !== page) {
        blocked.add('new window');
        void other.close().catch(() => {});
      }
    });
    await context.routeWebSocket(/.*/, (socket) => {
      recordBlocked(socket.url(), 'websocket');
      return socket.close({ code: 1000, reason: 'Offline replay' });
    });
    let initial = true;
    await context.route(/.*/, async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        initial &&
        request.method() === 'GET' &&
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame() &&
        url.href === html.url
      ) {
        initial = false;
        await route.fulfill({
          status: html.status,
          body: html.body,
          headers: {
            'content-type': html.contentType,
            'x-dns-prefetch-control': 'off',
            'content-security-policy': [html.contentSecurityPolicy, replayPolicy].filter(Boolean).join(', '),
          },
        });
        return;
      }
      const type = request.resourceType();
      url.hash = '';
      const asset = assets.get(url.href);
      const mime = asset?.contentType.split(';')[0].trim().toLowerCase() ?? '';
      if (
        asset &&
        request.method() === 'GET' &&
        (url.origin === origin || trustedAssetOrigin(url)) &&
        ((type === 'script' && isScriptType(mime)) ||
          (type === 'stylesheet' && mime === 'text/css') ||
          (type === 'font' && isFontType(mime)))
      ) {
        // Playwright supplies permissive CORS headers when the header is omitted.
        // An explicit empty value preserves a captured response with no CORS permission.
        await route.fulfill({ status: 200, contentType: asset.contentType, body: asset.body,
          headers: { 'access-control-allow-origin': asset.allowOrigin ?? '' } });
        return;
      }
      recordBlocked(url.href, dependencyTypes.has(type) ? type : undefined);
      await route.abort('blockedbyclient');
    });
    await page.goto(html.url, { waitUntil: 'load', timeout: browserReviewLimits.loadMs });
    await delay(browserReviewLimits.settleMs);
    return await action({ page, errors, blocked });
  } finally {
    await context.close().catch(() => {});
  }
}

function incomplete(replay: Replay, observed: Verdict): Verdict {
  if (!replay.blocked.size) return observed;
  const reasons = [...replay.blocked];
  const examples = reasons.slice(0, browserReviewLimits.exampleNames);
  if (examples.length < reasons.length) examples.push((reasons.length - examples.length) + ' more');
  return result(
    null,
    observed.detail +
      ' The replay blocked a dependency or action (' +
      examples.join(', ') +
      '). Verify this outcome in preview.',
  );
}

async function buttonIndex(page: Page, button: Locator) {
  const handle = await button.elementHandle();
  if (!handle) return -1;
  try {
    return await visibleControls(page)
      .evaluateAll((elements, target) => elements.indexOf(target), handle);
  } finally {
    await handle.dispose();
  }
}

async function clickControl(button: Locator, expected: Control): Promise<Verdict | undefined> {
  const element = await button.elementHandle();
  try {
    // Hover can rerender a menu. Pin the original element and verify its identity and safety after hovering.
    await element.hover();
    const [fresh] = (await element.evaluate(describeControls, 1)).controls;
    if (fresh.skip || !sameControl(expected, fresh)) return result(null, fresh.skip || 'The control changed before activation.');
    await element.click();
  } catch {
    return result(null, 'The isolated browser could not safely activate the original control.');
  } finally { await element.dispose(); }
}

async function namedJourney(replay: Replay, journey: Journey): Promise<Verdict & { index?: number }> {
  const { page } = replay;
  const button = page.getByRole('button', { name: journey.button, exact: true }).filter({ visible: true });
  const count = await button.count();
  if (count !== 1)
    return incomplete(
      replay,
      result(null, 'Expected one visible button with this accessible name. Found ' + count + '.'),
    );
  const index = await buttonIndex(page, button);
  if (!(await button.isEnabled()))
    return {
      index,
      ...incomplete(replay, result(null, 'The named button was disabled in the starting state.')),
    };
  const [control] = (await button.evaluateAll(describeControls, 1)).controls;
  if (!control || control.skip) return { index, ...result(null, control?.skip ?? 'The button changed before activation.') };
  const expected = page.getByText(journey.expected_text, { exact: true }).filter({ visible: true });
  if (await expected.count())
    return {
      index,
      ...result(
        null,
        'The expected text was already visible before the click. Choose a new visible outcome.',
      ),
    };
  const initialErrors = replay.errors.count;
  const skipped = await clickControl(button, control);
  if (skipped) return { index, ...skipped };
  try {
    await expected.first().waitFor({ state: 'visible' });
    await delay(browserReviewLimits.settleMs);
    if (replay.errors.count > initialErrors)
      return {
        index,
        ...incomplete(
          replay,
          result(false, 'An uncaught JavaScript exception occurred after the button was activated.'),
        ),
      };
    if (!(await expected.count()))
      return {
        index,
        ...incomplete(
          replay,
          result(false, 'The expected text appeared briefly and disappeared during the observation.'),
        ),
      };
    return {
      index,
      ...incomplete(
        replay,
        result(
          true,
          'The expected text “' +
            journey.expected_text +
            '” was absent before the click and visible afterwards in the isolated page.',
        ),
      ),
    };
  } catch {
    return {
      index,
      ...incomplete(
        replay,
        result(
          false,
          'The expected text “' +
            journey.expected_text +
            '” did not become visible within the two-second observation window after the click.',
        ),
      ),
    };
  }
}

async function appearsWithoutClick(replay: Replay, expectedText: string) {
  try {
    await replay.page
      .getByText(expectedText, { exact: true })
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible' });
    return true;
  } catch (error) {
    // A closed browser or interrupted control cannot validate a positive assertion.
    if (error instanceof Error && error.name === 'TimeoutError' && !replay.page.isClosed())
      return replay.blocked.size || replay.errors.count ? null : false;
    throw error;
  }
}

async function disclosure(replay: Replay, control: Control): Promise<Verdict> {
  const { page } = replay;
  const button = visibleControls(page).nth(control.index);
  const target = page.locator('[id=' + cssString(control.target!) + ']');
  if (
    !(await button.count()) ||
    (await button.getAttribute('aria-controls')) !== control.target ||
    (await button.getAttribute('aria-expanded')) !== control.expanded
  )
    return result(null, 'The initial control changed between isolated page loads.');
  if ((await target.count()) !== 1)
    return incomplete(
      replay,
      result(
        false,
        'The button declares a controlled element, but its ID did not identify exactly one element.',
      ),
    );
  if (!(await button.isEnabled())) return result(null, 'The disclosure was disabled in the starting state.');
  const wasOpen = control.expanded === 'true';
  if ((await target.isVisible()) !== wasOpen)
    return incomplete(
      replay,
      result(false, 'The initial expanded state disagreed with the visibility of its controlled element.'),
    );
  const initialErrors = replay.errors.count;
  try {
    const skipped = await clickControl(button, control);
    if (skipped) return skipped;
    await target.waitFor({ state: wasOpen ? 'hidden' : 'visible' });
    // The element may have been rerendered. Observe the state of the same declared control.
    const changed = page.locator(
      '[aria-controls=' + cssString(control.target!) + '][aria-expanded="' + !wasOpen + '"]',
    );
    await button.and(changed).waitFor({ state: 'visible' });
    if (replay.errors.count > initialErrors)
      return incomplete(
        replay,
        result(false, 'An uncaught JavaScript exception occurred after the disclosure was activated.'),
      );
    if ((await target.count()) !== 1 || (await target.isVisible()) === wasOpen)
      return incomplete(
        replay,
        result(false, 'The controlled element did not remain in its expected final state.'),
      );
    return incomplete(
      replay,
      result(
        true,
        'After the click, aria-expanded changed to ' +
          !wasOpen +
          ' and the controlled element became ' +
          (wasOpen ? 'hidden.' : 'visible.'),
      ),
    );
  } catch {
    return incomplete(
      replay,
      result(
        false,
        'Chromium could not confirm the click, expanded state and matching target visibility within the observation window.',
      ),
    );
  }
}

async function automaticChange(replay: Replay, control: Control, click: boolean): Promise<Verdict> {
  const button = visibleControls(replay.page).nth(control.index);
  const [fresh] = (await button.evaluateAll(describeControls, 1)).controls;
  if (!fresh || fresh.skip || !sameControl(control, fresh)) return result(null, fresh?.skip || 'The control changed between page loads.');
  if (click && control.family === 'Disclosure' && control.target && !/\s/.test(control.target) &&
    ['true', 'false'].includes(control.expanded ?? '')) return disclosure(replay, control);
  await button.hover();
  const probe = await watchControl(button);
  const initialErrors = replay.errors.count;
  try {
    if (click) {
      const skipped = await clickControl(button, control);
      if (skipped) return skipped;
    }
    try {
      await replay.page.waitForFunction((probe) => probe.change(), probe, { timeout: browserReviewLimits.actionMs });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'TimeoutError') || replay.page.isClosed()) throw error;
      if (replay.errors.count > initialErrors) return result(click ? false : null, 'An uncaught exception interrupted the observation.');
      return incomplete(replay, result(click ? null : false, click ? 'No observable change followed activation within two seconds.' : 'No change during the no-click observation.'));
    }
    await delay(browserReviewLimits.settleMs);
    const change = await probe.evaluate((p) => p.change());
    if (!change) return result(null, 'The observed change did not persist through the settling window.');
    if (replay.errors.count > initialErrors) return incomplete(replay, result(click ? false : null, 'An uncaught exception occurred during the observation.'));
    return incomplete(replay, result(true, 'Chromium observed that ' + change + '.'));
  } finally {
    await probe.evaluate((p) => p.stop()).catch(() => {});
    await probe.dispose();
  }
}

export function launchHealthBrowser(): Promise<Browser> {
  const channel =
    process.env.HEALTHCHECK_BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined);
  return chromium.launch({
    channel,
    headless: true,
    chromiumSandbox: true,
    timeout: browserReviewLimits.launchMs,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) =>
          value !== undefined &&
          /^(?:PATH|HOME|USERPROFILE|TMP|TEMP|TMPDIR|SystemRoot|windir|SystemDrive|ProgramFiles(?:\(x86\))?|ProgramW6432|APPDATA|LOCALAPPDATA|LD_LIBRARY_PATH|LANG|LC_ALL|TZ|XDG_RUNTIME_DIR)$/i.test(
            key,
          ),
      ),
    ) as Record<string, string>,
    proxy: { server: 'http://127.0.0.1:9' },
    args: [
      '--proxy-bypass-list=<-loopback>',
      '--disable-quic',
      '--dns-prefetch-disable',
      '--host-resolver-rules=MAP * ~NOTFOUND',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-background-networking',
      '--no-pings',
    ],
  });
}

/** Read the same signed-out starting state used by named button checks, without activating a control. */
export async function discoverBrowserButtons(html: PublicPage, assets: Assets): Promise<ButtonDiscovery> {
  let browser: Browser | undefined;
  const deadline = AbortSignal.timeout(browserReviewLimits.reviewMs);
  const stop = () => { if (browser) void browser.close().catch(() => {}); };
  try {
    browser = await launchHealthBrowser();
    deadline.addEventListener('abort', stop, { once: true });
    deadline.throwIfAborted();
    const hosts: ReplayHosts = { loaded: new Set(), blocked: new Set() };
    return await inReplay(browser, html, assets, async ({ page, blocked, errors }) => {
      const visible = page.getByRole('button').filter({ visible: true });
      const total = await visible.count();
      const session = await page.context().newCDPSession(page);
      const buttons: DiscoveredButton[] = [];
      const limitations: string[] = [];
      try {
        // Chromium computes names from visible text, ARIA, associated labels and input values.
        // Confirm each name against the exact same locator that will execute the check.
        const tree = await session.send('Accessibility.getFullAXTree');
        const names = new Set(tree.nodes
          .filter((node) => !node.ignored && node.role?.value === 'button')
          .map((node) => String(node.name?.value ?? '')));
        let listed = 0;
        for (const name of names) {
          if (listed >= browserReviewLimits.detailedButtons) break;
          const matches = page.getByRole('button', { name, exact: true }).filter({ visible: true });
          const count = await matches.count();
          if (!count) continue;
          const first = matches.first();
          const ambiguous = count !== 1;
          const disabled = !ambiguous && !await first.isEnabled();
          const [control] = (await first.evaluateAll(describeControls, 1)).controls;
          const safe = !!control && !control.skip;
          const automatic = !ambiguous && safe && !!control.family;
          buttons.push({
            name: name.slice(0,160), ambiguous, disabled, automatic,
            selectable: !!name.trim() && name.length <= 160 && !ambiguous && safe,
          });
          listed += count;
        }
        if (listed < total) limitations.push(`The picker matched ${listed} of ${total} visible buttons within its discovery limits.`);
      } finally {
        await session.detach().catch(() => {});
      }
      if (blocked.size || errors.count) limitations.push('Some resources or scripts could not run in the offline copy. More buttons may appear on the site.');
      limitations.push(...hostNotes(hosts));
      return { buttons, total, limitations };
    }, hosts);
  } catch {
    // This is an ordinary inspection failure. Return it as such rather than implying an empty site.
    throw new HttpError(422, 'Button discovery could not finish in the isolated browser. Try again or enter a button name manually.');
  } finally {
    deadline.removeEventListener('abort', stop);
    if (browser) await browser.close().catch(() => {});
  }
}

export async function reviewBrowser(
  pages: readonly HtmlPage[],
  assets: Assets,
  journeys: readonly Journey[],
  signal: AbortSignal,
  onRendered?: RenderObserver,
): Promise<Evidence> {
  const evidence: Evidence = {
    checks: [],
    limitations: [
      'Chromium replays captured HTML and permitted assets in fresh signed-out sessions. Network-dependent actions, authenticated workflows, saved data and server-side effects require separate evidence.',
    ],
  };
  const start = pages[0];
  function add(page: HtmlPage | undefined, key: string, title: string, verdict: Verdict, category = 'browser_functions') {
    const address = page ? new URL(page.url) : null;
    const label = address ? address.origin + address.pathname : undefined;
    evidence.checks.push({
      key: digest((label ?? '') + '\n' + key).slice(0, 24),
      category,
      title,
      ...verdict,
      page: label,
      source: 'browser',
      recommendation: 'Repeat this interaction in a controlled preview and record its visible outcome.',
    });
  }
  const namedKeys = new Set<number>();
  const finishedPages = new Set<HtmlPage>();
  function addJourney(index: number, outcome: Verdict) {
    const journey = journeys[index];
    add(
      start,
      'journey-' + journey.button + '\n' + journey.expected_text,
      'Button: ' + journey.button,
      outcome,
    );
    namedKeys.add(index);
  }
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(browserReviewLimits.reviewMs)]);
  let browser: Browser | undefined;
  const hosts: ReplayHosts = { loaded: new Set(), blocked: new Set() };
  function replayPage<T>(page: HtmlPage, action: (replay: Replay) => Promise<T>) {
    return inReplay(browser!, page, assets, action, hosts);
  }
  const stop = () => {
    if (browser) void browser.close().catch(() => {});
  };
  let interrupted = '';
  try {
    if (!start) throw new Error('no-html');
    deadline.throwIfAborted();
    browser = await launchHealthBrowser();
    deadline.addEventListener('abort', stop, { once: true });
    deadline.throwIfAborted();
    let autoCount = 0;
    for (const page of pages) {
      deadline.throwIfAborted();
      let inventory: Inventory;
      try {
        inventory = await replayPage(page, async (replay) => {
          const body = replay.page.locator('body');
          const rendered = (await body.isVisible()) && !!(await body.innerText()).trim();
          add(
            page,
            'rendered-text',
            'Visible page text',
            rendered
              ? result(true, 'The Chromium document contained rendered body text after the initial load.')
              : incomplete(
                  replay,
                  result(false, 'Chromium found no rendered body text during the initial observation.'),
                ),
          );
          const errors = replay.errors.count;
          const hasScripts =
            (await replay.page.locator('script').evaluateAll((nodes) =>
              nodes.some((node) => {
                const type = (node.getAttribute('type') || '').toLowerCase().trim();
                return !type || type === 'module' || /(?:java|ecma)script/.test(type);
              }),
            )) || (await replay.page.locator('[onclick]').count()) > 0;
          if (errors || hasScripts || replay.blocked.size)
            add(
              page,
              'initial-js',
              'Initial JavaScript exceptions',
              incomplete(
                replay,
                result(
                  !errors,
                  errors
                    ? errors +
                        ' uncaught page exception(s) during the initial load, including ' +
                        replay.errors.first +
                        '.'
                    : 'Chromium observed no uncaught page exception during the initial load and settling window.',
                ),
              ),
            );
          if (onRendered) {
            const markup = await replay.page.evaluate((limit) => {
              const html = document.documentElement.outerHTML;
              return html.length <= limit && new TextEncoder().encode(html).length <= limit ? html : null;
            }, healthReadLimits.bytes);
            if (markup !== null) onRendered(page, markup, !!(errors || replay.blocked.size));
            else add(page, 'rendered-links-limit', 'Additional rendered links untested',
              result(null, 'The rendered document exceeded the 1 MiB inspection limit.'), 'core_journeys');
          }
          const buttons = await collectButtons(replay.page, browserReviewLimits.detailedButtons);
          try {
            await inspectBrowserAccess(replay.page, (key, title, passed, detail) =>
              add(page, key, title, incomplete(replay, result(passed, detail)), 'access_data'));
          } catch {
            add(page, 'access-incomplete', 'Browser accessibility and form checks unfinished',
              result(null, 'Chromium could not finish inspecting the rendered controls and text.'), 'access_data');
          }
          return buttons;
        });
      } catch {
        add(
          page,
          'document',
          'Browser inspection incomplete',
          result(null, 'Chromium could not inspect this captured page within the review limits.'),
        );
        finishedPages.add(page);
        continue;
      }
      const reported = new Set<number>();
      if (page === start) {
        for (const [index, journey] of journeys.entries()) {
          deadline.throwIfAborted();
          try {
            let verdict = await replayPage(page, (replay) => namedJourney(replay, journey));
            if (verdict.passed) {
              const passiveMatch = await replayPage(page, (replay) =>
                appearsWithoutClick(replay, journey.expected_text),
              );
              if (passiveMatch === null)
                verdict = result(null, 'A blocked dependency or page error interrupted the separate no-click observation.');
              else if (passiveMatch)
                verdict = result(null, 'The expected text also appeared in a fresh replay without a click. This check cannot attribute the change to the button.');
              else
                verdict = { ...verdict, detail: verdict.detail + ' The text stayed absent in a separate two-second replay without a click.' };
            }
            addJourney(index, result(verdict.passed, verdict.detail));
            if (verdict.index !== undefined && verdict.index >= 0) reported.add(verdict.index);
          } catch {
            addJourney(index, result(null, 'The isolated browser could not finish this button check.'));
          }
        }
      }
      const hasReject = inventory.controls.some((c) => c.cookieChoice === 'reject' && !c.skip);
      const ordered = [...inventory.controls].sort((a, b) => Number(b.cookieChoice === 'reject') - Number(a.cookieChoice === 'reject'));
      let outsideBudget = 0;
      for (const control of ordered) {
        const name = control.label.slice(0, browserReviewLimits.labelLength) || 'button ' + (control.index + 1);
        const category = control.mainCta ? 'core_journeys' : 'browser_functions';
        const key = 'control-' + control.index;
        const skip = control.skip || (hasReject && control.cookieChoice === 'accept' ? 'Skipped consent acceptance because a rejection control was available.' : null);
        if (skip || (!control.family && control.mainCta)) {
          add(page, key, 'Skipped: ' + name, result(null, skip ?? 'This main action has no safely identifiable interaction.'), category);
          reported.add(control.index);
          continue;
        }
        if (!control.family) continue;
        if (autoCount >= browserReviewLimits.automaticJourneys) { outsideBudget++; continue; }
        deadline.throwIfAborted();
        autoCount++;
        const title = control.family + ': ' + name;
        try {
          let verdict = await replayPage(page, (replay) => automaticChange(replay, control, true));
          if (verdict.passed) {
            const passive = await replayPage(page, (replay) => automaticChange(replay, control, false));
            verdict = passive.passed === false
              ? result(true, verdict.detail + ' A separate replay stayed stable without activation.')
              : result(null, 'The no-click replay could not attribute the change to this control.');
          }
          add(page, key, title, verdict, category);
        } catch {
          add(page, key, title, result(null, 'The isolated browser could not finish this control check.'), category);
        }
        reported.add(control.index);
      }
      const untested = inventory.total - reported.size;
      if (untested > 0) {
        const examples = inventory.controls
          .filter((c) => !reported.has(c.index) && c.label)
          .slice(0, browserReviewLimits.exampleNames)
          .map((c) => c.label.slice(0, browserReviewLimits.labelLength));
        add(
          page,
          'other-buttons',
          'Buttons without a verified outcome',
          result(
            null,
            untested +
              ' of ' +
              inventory.total +
              ' initially visible buttons lack a conclusive outcome.' +
              (examples.length ? ' Examples include ' + examples.join(', ') + '.' : '') +
              (outsideBudget ? ' The automatic action budget left ' + outsideBudget + ' eligible control(s) untested.' : '') +
              (inventory.total > inventory.controls.length ? ' Additional controls exceeded the inventory limit.' : '') +
              ' Controls without a recognised safe action need a named outcome.',
          ),
        );
      } else if (!inventory.total) {
        evidence.limitations.push(
          'Chromium found no visible buttons in the initial state of ' +
            new URL(page.url).pathname +
            '. Controls that appear after other actions require a separate journey.',
        );
      }
      finishedPages.add(page);
    }
  } catch {
    interrupted = !start
      ? 'No captured HTML page was available to Chromium.'
      : deadline.aborted
        ? 'The review reached its time limit before the browser checks finished.'
        : !browser
          ? 'A sandboxed Chromium browser could not start on this installation.'
          : 'The isolated browser stopped before its checks finished.';
    add(start, 'browser-incomplete', 'Browser review incomplete', result(null, interrupted));
  } finally {
    deadline.removeEventListener('abort', stop);
    if (browser) await browser.close().catch(() => {});
  }
  for (const index of journeys.keys())
    if (!namedKeys.has(index))
      addJourney(index, result(null, interrupted || 'The starting page could not be inspected in Chromium.'));
  for (const page of pages)
    if (!finishedPages.has(page))
      add(
        page,
        'page-incomplete',
        'Browser checks unfinished for this page',
        result(null, interrupted || 'The isolated browser could not finish the checks on this page.'),
      );
  evidence.limitations.push(...hostNotes(hosts));
  return evidence;
}
