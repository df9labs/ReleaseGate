import robotsParser from 'robots-parser';
import type { PageReader } from './health-pages';

export const REVIEW_MS = 75_000;
export async function readCrawlPolicy(origin: string, read: PageReader, signal: AbortSignal) {
  const url = new URL('/robots.txt', origin);
  const response = await read(url, { signal, origin, allowUrl: (u) => u.href === url.href });
  // RFC 9309 2.3.1.3: a 4xx robots.txt (other than 429) means no crawl restrictions.
  const missing = response.status >= 400 && response.status < 500 && response.status !== 429;
  const plain = response.status === 200 && /^text\/plain\b/i.test(response.contentType);
  const lines = plain ? response.body.split(/\r?\n/).map((line) => line.split('#', 1)[0].trim()).filter(Boolean) : [];
  const directives = lines.filter((line) => /^(user-agent|allow|disallow|crawl-delay|sitemap)\s*:/i.test(line)).length;
  const rules = robotsParser(url.href, plain && directives ? response.body : '');
  const product = 'ReleaseGateHealthcheck';
  const waitMs = Math.max(250, (rules.getCrawlDelay(product) ?? 0) * 1000);
  let limitation = '';
  if (!missing && (!plain || (lines.length && !directives))) limitation = 'The robots policy could not be read as public crawl instructions.';
  else if (!Number.isFinite(waitMs) || waitMs >= REVIEW_MS) limitation = 'The published crawl delay exceeds the review time budget.';
  return { status: response.status, directives, waitMs, limitation, sitemaps: rules.getSitemaps(),
    allowed: (u: URL) => u.origin === origin && rules.isAllowed(u.href, product) !== false };
}
