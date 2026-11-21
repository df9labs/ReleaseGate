import { SaxesParser } from 'saxes';
import type { DefaultTreeAdapterTypes } from 'parse5';
import { setTimeout as delay } from 'node:timers/promises';
import type { PageReader } from './health-pages';
import { eligibleLink, type LinkPolicy } from './health-links';
import { HealthReadError, type PublicPage } from './health-transport';

export type ReleaseObservation = (key: string, title: string, passed: boolean | null, detail: string) => void;
const metaNames = new Set(['version', 'build', 'build-id', 'build-version', 'release-version', 'app-version', 'application-version', 'revision', 'generator']);

export function inspectPageRelease(page: PublicPage, nodes: DefaultTreeAdapterTypes.Element[], add: ReleaseObservation) {
  const https = new URL(page.url).protocol === 'https:';
  add('https', 'HTTPS delivery', https, 'The observed page response used ' + (https ? 'HTTPS.' : 'HTTP.'));
  const headers = page.releaseHeaders;
  add('hsts', 'HTTP Strict Transport Security', headers && https ? headers.hsts : null,
    !https ? 'HSTS requires an HTTPS response.' : !headers ? 'The reader supplied no HSTS header observation.' :
      headers.hsts ? 'The HTTPS response declared a positive HSTS max-age.' : 'No positive HSTS max-age was present on the HTTPS response.');
  add('security-headers', 'Response security headers', headers ? headers.security.length > 0 : null,
    !headers ? 'No response header evidence was available.' : headers.security.length ? 'Observed headers included ' + headers.security.join(', ') + '.' :
      'The response supplied none of the inspected security headers.');
  const declared = new Map<string, string>();
  for (const node of nodes) {
    if (node.tagName !== 'meta' || !node.parentNode || !('tagName' in node.parentNode) || node.parentNode.tagName !== 'head') continue;
    const name = node.attrs.find((a) => a.name === 'name')?.value.toLowerCase() ?? '';
    const value = node.attrs.find((a) => a.name === 'content')?.value.trim();
    if (metaNames.has(name) && value && /^[\w .+@()/-]{1,80}$/.test(value) &&
      (name !== 'generator' || /\d/.test(value))) declared.set(name, value);
  }
  const values = [...(headers?.build ?? []), ...Array.from(declared, ([k, v]) => k + ' ' + v)];
  add('build-meta', 'Published build or version metadata', values.length ? true : null, values.length ?
    'The response declared ' + values.join(', ') + '. This identifies published metadata only.' :
    'No recognised public build or version value was available in the inspected headers or metadata.');
}

function sitemapEntries(body: string) {
  const parser = new SaxesParser({ xmlns: true });
  const stack: string[] = [];
  let root = '', loc = '', collecting = false, count = 0;
  parser.on('doctype', () => { throw new Error('Unsupported document type'); });
  parser.on('opentag', (tag) => {
    const name = !tag.uri || tag.uri === 'http://www.sitemaps.org/schemas/sitemap/0.9' ? tag.local : '';
    stack.push(name);
    if (stack.length === 1) {
      root = name;
      if (root !== 'urlset' && root !== 'sitemapindex') throw new Error('Unknown root');
    }
    collecting = stack.length === 3 && stack[1] === (root === 'urlset' ? 'url' : 'sitemap') && name === 'loc';
    if (collecting) loc = '';
  });
  const append = (text: string) => { if (collecting) loc += text; };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', () => {
    if (collecting) {
      const url = URL.parse(loc.trim());
      if (url && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) count++;
      collecting = false;
    }
    stack.pop();
  });
  parser.write(body).close();
  return { root, count };
}

export async function inspectSitemap(origin: string, advertised: string[], policy: LinkPolicy | undefined,
  read: PageReader, signal: AbortSignal, add: ReleaseObservation, skipReason: string) {
  const result = (passed: boolean | null, detail: string) => add('sitemap', 'Published sitemap', passed, detail);
  if (!policy || signal.aborted) return result(null, signal.aborted ? 'The capture deadline was reached.' : skipReason);
  const candidates = advertised.length ? advertised : [new URL('/sitemap.xml', origin).href];
  const url = candidates.map((href) => URL.parse(href, origin)).find((u) => u && !u.hash &&
    eligibleLink(u, origin, false) && policy.allowed(u));
  if (!url) return result(null, 'The sitemap address was outside the permitted origin, path or robots policy.');
  if (advertised.length > 1) add('other-sitemaps', 'Additional advertised sitemaps', null,
    'The review reads one sitemap. Other advertised addresses were not inspected.');
  try {
    await delay(policy.waitMs, undefined, { signal });
    const page = await read(url, { origin, signal, sitemap: true, allowUrl: (u) => u.href === url.href && policy.allowed(u) });
    if (page.status !== 200 || !/^(?:application\/xml|text\/(?:xml|plain))\b/i.test(page.contentType))
      return result(advertised.length && [404, 410].includes(page.status) ? false : null,
        'The sitemap read returned HTTP ' + page.status + ' without a readable XML sitemap.');
    try {
      const { root, count } = sitemapEntries(page.body);
      return result(count > 0, 'The XML ' + root + ' at ' + url.pathname + ' contained ' + count + ' readable HTTP(S) location(s).');
    } catch { return result(false, 'The response could not be parsed as a supported XML sitemap or sitemap index.'); }
  } catch (error) {
    if (!(error instanceof HealthReadError) && !signal.aborted) throw error;
    return result(null, signal.aborted ? 'The capture deadline was reached.' : (error as HealthReadError).message);
  }
}
