import { ErrorCodes, parse, type DefaultTreeAdapterTypes } from 'parse5';
import { setTimeout as delay } from 'node:timers/promises';
import { HealthReadError, type PublicPage, readPublicPage } from './health-transport';
import type { HealthObservation } from '../src/api';
import { digest } from './support';
import { compareSearchMetadata, inspectMarkup, type SearchMetadata } from './health-markup';

import { collectLinks, eligibleLink, includeRenderedLinks, LINK_LIMIT, probeLinks, recordLinks, type LinkPage, type LinkPolicy, type LinkResponse } from './health-links';
import { inspectPageRelease, inspectSitemap, type ReleaseObservation } from './health-release';
import { readCrawlPolicy } from './health-crawl';
import { inspectGenericContent, mergeGenericContent, summariseGenericContent, type PageContent } from './health-content';

export const PAGE_LIMIT = 4;
export const MAX_PAGE_LIMIT = 25;
export { REVIEW_MS } from './health-crawl';
export type PageReader = typeof readPublicPage;
export type Check = HealthObservation & {
  key: string;
  category: string;
  recommendation: string;
};
export interface ReviewEvidence {
  checks: Check[];
  pages: { url: string; status: number | null }[];
  limitations: string[];
}
interface ReviewOptions {
  environment?: string;
  maxPages?: number;
  onHtmlPage?: (page: PublicPage) => void;
  prepareReplay?: (pages: PublicPage[]) => Promise<(onRendered: RenderObserver) => Promise<Pick<ReviewEvidence, 'checks' | 'limitations'>>>;
}
export type RenderObserver = (page: PublicPage, markup: string, partial: boolean) => void;
type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
const attr = (node: Element, key: string) => node.attrs.find((a) => a.name === key)?.value;
const htmlTypes = new Set(['text/html', 'application/xhtml+xml']);
function elements(root: Node) {
  const result: Element[] = [],
    pending: Node[] = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if ('tagName' in node) {
      result.push(node);
      if (['script', 'style', 'template', 'noscript'].includes(node.tagName)) continue;
    }
    if ('childNodes' in node)
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
  return result;
}
function hasText(root: Node) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.nodeName === '#text' && 'value' in node && node.value.trim()) return true;
    if ('tagName' in node && ['script', 'style', 'template', 'noscript'].includes(node.tagName)) continue;
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
  }
  return false;
}

function nofollow(nodes: Element[], page: PublicPage) {
  return /(?:^|[:,\s])(?:nofollow|none)(?:$|[,\s])/i.test(page.robotsTag ?? '') || nodes.some((n) =>
    n.tagName === 'meta' && /^(robots|releasegatehealthcheck)$/i.test(attr(n, 'name') || '') &&
    /\b(nofollow|none)\b/i.test(attr(n, 'content') || ''));
}
function inspect(page: PublicPage, evidence: ReviewEvidence, options: ReviewOptions, sample: SearchMetadata[], documents: LinkPage[], content: PageContent[]): string[] {
  const url = new URL(page.url),
    label = url.origin + url.pathname;
  const add = (
    key: string,
    category: string,
    title: string,
    passed: boolean | null,
    detail: string,
    recommendation: string,
  ) => {
    evidence.checks.push({
      key: digest(label).slice(0, 20) + '-' + key,
      category,
      title,
      passed,
      detail,
      page: label,
      source: 'website',
      recommendation,
    });
  };
  const ok = page.status >= 200 && page.status < 300;
  add(
    'http',
    'reliability',
    ok ? 'Page responded successfully' : 'Page returned an unsuccessful HTTP status',
    ok,
    'HTTP ' + page.status,
    'Review the response for this page and repeat the check.',
  );
  if (!ok || !htmlTypes.has(page.contentType.split(';')[0].trim().toLowerCase())) {
    add(
      'html',
      'usability',
      'Page content checks',
      null,
      ok
        ? 'The response was not an HTML document.'
        : 'An accessible HTML page is required for content checks.',
      'Supply the public HTML page or record operator evidence.',
    );
    return [];
  }
  options.onHtmlPage?.(page);
  let duplicateAttributes = 0;
  const nodes = elements(parse(page.body, { onParseError(error) {
    if (error.code === ErrorCodes.duplicateAttribute) duplicateAttributes++;
  } })),
    body = nodes.find((n) => n.tagName === 'body');
  const head = nodes.find((n) => n.tagName === 'head'),
    title = head?.childNodes.find(
      (n) => 'tagName' in n && n.tagName === 'title' && n.namespaceURI === head.namespaceURI,
    ),
    html = nodes.find((n) => n.tagName === 'html');
  const titled = !!title && hasText(title),
    lang = !!html && !!attr(html, 'lang')?.trim();
  add(
    'title',
    'usability',
    titled ? 'Page has a title' : 'Page title missing',
    titled,
    titled
      ? 'The delivered HTML has a non-empty title.'
      : 'No non-empty title was found in the delivered HTML.',
    'Give this page a descriptive document title.',
  );
  add(
    'lang',
    'usability',
    lang ? 'Document language declared' : 'Document language missing',
    lang,
    lang ? 'The html element declares a language.' : 'The html element has no language declaration.',
    'Declare the primary language on the html element.',
  );
  const images = nodes.filter(
    (n) =>
      n.tagName === 'img' &&
      !['presentation', 'none'].includes(attr(n, 'role') || '') &&
      attr(n, 'aria-hidden') !== 'true',
  );
  if (images.length) {
    const missing = images.filter((n) => attr(n, 'alt') === undefined);
    add(
      'image-alt',
      'access_data',
      missing.length ? 'Image missing alternative text' : 'Image alternatives declared',
      !missing.length,
      missing.length +
        ' of ' +
        images.length +
        ' image(s) lack an alt attribute. Empty alt text is accepted for decorative images.',
      'Add meaningful alternative text or an empty alt attribute for a decorative image.',
    );
  }
  const note = (detail: string) => evidence.limitations.push(label + ' — ' + detail);
  sample.push(inspectMarkup(nodes, url, duplicateAttributes, options.environment, add, note));
  if (page.robotsTag) {
    const excludes = /(?:^|[:,\s])(?:noindex|none)(?:$|[,\s])/i.test(page.robotsTag);
    note(excludes
      ? 'An X-Robots-Tag response header requests exclusion from search results for at least one crawler. ' +
        (options.environment === 'preview' ? 'This can be intentional on a preview.' : 'Confirm this matches the intended audience.')
      : 'The response declares X-Robots-Tag crawler directives. Search indexing was not verified.');
  }
  const canFollow = !nofollow(nodes, page);
  if (!canFollow) note('Published crawler directives requested that links on this page should not be followed.');
  const document = collectLinks(nodes, url, canFollow, page.hadQuery);
  documents.push(document);
  inspectPageRelease(page, nodes, (key, title, passed, detail) =>
    add(key, 'release_evidence', title, passed, detail, 'Review the published response and release configuration.'));
  if (!body || !hasText(body)) {
    add(
      'content',
      'usability',
      'Rendered page content',
      null,
      'No body text was found in the delivered HTML. JavaScript-rendered content requires a browser observation.',
      'Supply observations from the rendered page.',
    );
    return document.candidates;
  }
  add(
    'content',
    'usability',
    'Page content delivered',
    true,
    'The returned HTML body contains text outside scripts, templates and styles.',
    'Confirm the user journey in a browser.',
  );
  content.push(inspectGenericContent(nodes, url.pathname));
  const headings = nodes.filter((n) => n.tagName === 'h1' && hasText(n));
  add(
    'heading',
    'usability',
    headings.length ? 'Main heading present' : 'Main heading missing',
    headings.length > 0,
    headings.length + ' non-empty h1 heading(s) in the delivered HTML.',
    'Give the page a descriptive main heading.',
  );
  return document.candidates;
}

export async function reviewWebsite(
  start: URL,
  follow: boolean,
  read: PageReader,
  signal: AbortSignal,
  options: ReviewOptions = {},
): Promise<ReviewEvidence> {
  const maxPages = options.maxPages ?? PAGE_LIMIT;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGE_LIMIT)
    throw new RangeError('Choose between 1 and ' + MAX_PAGE_LIMIT + ' pages.');
  const searchSample: SearchMetadata[] = [];
  const evidence: ReviewEvidence = {
    checks: [],
    pages: [],
    limitations: [
      'Checks cover the delivered HTML. JavaScript interactions, sign-in and visual appearance require browser evidence.',
      'Search metadata checks cover the sampled pages only. Search indexing, rankings and snippet selection are unverified.',
    ],
  };
  const seen = new Set<string>();
  const documents: LinkPage[] = [];
  const contentPages: PageContent[] = [];
  const responses = new Map<string, LinkResponse>();
  const captured: PublicPage[] = [];
  async function visit(u: URL, origin?: string, allowUrl?: (target: URL) => boolean) {
    try {
      const page = await read(u, { signal, origin, allowUrl, releaseEvidence: true });
      const previous = !page.hadQuery ? responses.get(page.url) : undefined;
      const observed: LinkResponse = previous?.status === page.status ? previous : { status: page.status };
      const requested = new URL(u.href);
      requested.hash = '';
      responses.set(requested.href, observed);
      if (!page.hadQuery) responses.set(page.url, observed);
      if (seen.has(page.url)) return [];
      seen.add(page.url);
      evidence.pages.push({ url: page.url, status: page.status });
      const links = inspect(page, evidence, options, searchSample, documents, contentPages);
      const document = documents.at(-1);
      if (document?.page === page.url) {
        observed.targets = document.targets;
        if (options.prepareReplay) captured.push(page);
      }
      return links;
    } catch (error) {
      if (!(error instanceof HealthReadError)) throw error;
      if (error.kind === 'policy' && !origin) throw error;
      const label = u.origin + u.pathname;
      responses.set(u.href, { status: null, reason: error.message });
      evidence.pages.push({ url: label, status: null });
      const tested = error.kind === 'network' || error.kind === 'timeout';
      evidence.checks.push({
        key: digest(label).slice(0, 20) + '-http',
        category: 'reliability',
        title: tested ? 'Page could not be reached' : 'Page could not be inspected',
        passed: tested ? false : null,
        page: label,
        source: 'website',
        detail: error.message,
        recommendation: 'Check the public URL and repeat the review from this installation.',
      });
      return [];
    }
  }
  const links = await visit(start);
  const origin = new URL(evidence.pages[0]?.url ?? start.href).origin;
  const addRelease: ReleaseObservation = (key, title, passed, detail) => evidence.checks.push({
    key: digest(origin + '\n' + key).slice(0, 24), category: 'release_evidence', title, passed, detail,
    source: 'website', page: origin + '/', recommendation: 'Review the published crawl configuration and repeat the check.',
  });
  let policy: LinkPolicy | undefined;
  let sitemaps: string[] = [];
  let robotsObserved = false;
  let skipReason = !follow ? 'Link following was switched off.' : 'The starting page did not permit further inspection.';
  if (follow && documents[0]?.follow && !signal.aborted) {
    try {
      const rules = await readCrawlPolicy(origin, read, signal);
      sitemaps = rules.sitemaps;
      addRelease('robots', 'Published robots policy', rules.directives > 0 || null, rules.directives ?
        'Read ' + rules.directives + ' crawl directive(s) and ' + sitemaps.length + ' sitemap address(es). The policy ' +
        (rules.allowed(new URL(documents[0].page)) ? 'allows' : 'disallows') + ' the starting path for this reader. Crawl interval ' + rules.waitMs + ' ms.' :
        'The robots.txt request returned HTTP ' + rules.status + ' with no readable crawl directives.');
      robotsObserved = true;
      if (!rules.limitation) policy = rules;
      else {
        skipReason = rules.limitation;
        evidence.limitations.push(skipReason);
      }
      const allowLinkedPage = (u: URL) => eligibleLink(u, origin) && !!policy?.allowed(u);
      const queue = new Set<string>();
      const attempted = new Set([start.origin + start.pathname]);
      const excluded = new Set<string>();
      function enqueue(candidates: string[]) {
        for (const href of candidates) {
          if (!allowLinkedPage(new URL(href))) excluded.add(href);
          else if (!attempted.has(href) && !seen.has(href)) queue.add(href);
        }
      }
      if (policy) enqueue(links);
      try {
        for (const href of queue) {
          if (seen.has(href)) {
            queue.delete(href);
            continue;
          }
          if (attempted.size >= maxPages || signal.aborted) break;
          await delay(rules.waitMs, undefined, { signal });
          queue.delete(href);
          attempted.add(href);
          const found = await visit(new URL(href), origin, allowLinkedPage);
          if (maxPages > PAGE_LIMIT) enqueue(found);
        }
      } finally {
        const remaining = [...queue].filter((href) => !seen.has(href)).length;
        if (remaining) evidence.limitations.push(
          remaining + ' known eligible internal link(s) remained outside the HTML sample when the ' +
          (attempted.size >= maxPages ? maxPages + '-page sample' : 'crawl budget') + ' ended.',
        );
        if (excluded.size) evidence.limitations.push(excluded.size + ' linked page(s) excluded by robots rules.');
      }
    } catch (error) {
      if (!(error instanceof HealthReadError) && !signal.aborted) throw error;
      skipReason = signal.aborted ? 'The shared capture deadline was reached.' : 'The crawl policy or a linked page could not be read.';
      evidence.limitations.push(skipReason);
    }
  }
  // Capture replay dependencies before spending the remaining live-read budget on optional destinations.
  const replay = await options.prepareReplay?.(captured);
  const rendered = new Map<string, LinkPage>();
  const renderedContent: PageContent[] = [];
  const observe: RenderObserver = (page, markup, partial) => {
    const original = documents.find((doc) => doc.page === page.url);
    if (!original) return;
    const nodes = elements(parse(markup));
    const current = collectLinks(nodes, new URL(page.url), original.follow && !nofollow(nodes, page));
    current.partial = partial;
    rendered.set(page.url, current);
    renderedContent.push(inspectGenericContent(nodes, new URL(page.url).pathname));
  };
  async function readDestinations() {
    if (!documents.length) return LINK_LIMIT;
    if (!robotsObserved) addRelease('robots', 'Published robots policy', null, signal.aborted ? 'The capture deadline was reached.' : skipReason);
    await inspectSitemap(origin, sitemaps, policy, read, signal, addRelease, skipReason);
    return probeLinks(documents, responses, read, signal, policy, LINK_LIMIT);
  }
  const [browser, remaining] = await Promise.all([replay?.(observe), readDestinations()]);
  if (browser) {
    evidence.checks.push(...browser.checks);
    evidence.limitations.push(...browser.limitations);
  }
  if (rendered.size) {
    for (const doc of documents) {
      const current = rendered.get(doc.page);
      if (!current) continue;
      includeRenderedLinks(doc, current);
      const response = responses.get(doc.page);
      if (response) { response.targets = doc.targets; response.partial = doc.partial; }
    }
    await probeLinks(documents, responses, read, signal, policy, remaining);
  }
  recordLinks(documents, responses, follow, policy, evidence.checks);
  if (signal.aborted)
    evidence.limitations.push('The live-read time budget ended. Only completed reads contribute evidence.');
  compareSearchMetadata(searchSample, evidence.limitations);
  // Review notes only. They never add or change a check.
  evidence.limitations.push(...summariseGenericContent(mergeGenericContent(contentPages, renderedContent)));
  return evidence;
}
