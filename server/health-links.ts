import type { DefaultTreeAdapterTypes } from 'parse5';
import { setTimeout as delay } from 'node:timers/promises';
import type { Check, PageReader } from './health-pages';
import { HealthReadError } from './health-transport';
import { digest } from './support';

export const LINK_LIMIT = 40;
type Element = DefaultTreeAdapterTypes.Element;
const attr = (node: Element, key: string) => node.attrs.find((a) => a.name === key)?.value;
const statefulRoute = /(?:^|[\/._-])(?:log[-_]?out|sign[-_]?out|delete|remove|reset|confirm|unsubscribe|checkout|pay|buy|purchase|submit|send|activate|redeem|token|callback|admin)(?:$|[\/._-])/i;

export function eligibleLink(u: URL, origin: string, htmlOnly = true) {
  if (!['http:', 'https:'].includes(u.protocol) || u.origin !== origin || u.username || u.password || u.search) return false;
  try {
    const path = decodeURIComponent(u.pathname);
    if (statefulRoute.test(path)) return false;
    const extension = path.split('/').pop()?.match(/\.([a-z0-9]+)$/i)?.[1];
    return !htmlOnly || !extension || /^(html?|aspx?|php)$/i.test(extension);
  } catch { return false; }
}

type Link = { url: URL; kind: string; skip?: string; local: boolean; fragment: boolean };
export type LinkPage = {
  page: string; targets: Set<string>; links: Link[]; follow: boolean; candidates: string[];
  partial?: boolean; overflow: number; invalid: number; mailto: number; tel: number;
};
export type LinkResponse = { status: number | null; method?: 'GET' | 'HEAD'; targets?: Set<string>; partial?: boolean; reason?: string };
export type LinkPolicy = { waitMs: number; allowed: (url: URL) => boolean };
type Add = (key: string, title: string, passed: boolean | null, detail: string) => void;

function linkText(element: Element) {
  const parts = [attr(element, 'aria-label') ?? '', attr(element, 'title') ?? ''];
  const pending = [...element.childNodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if ('value' in node) parts.push(node.value);
    else if ('tagName' in node && !['template', 'script', 'style'].includes(node.tagName)) {
      if (node.tagName === 'img') parts.push(attr(node, 'alt') ?? '');
      for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
    }
  }
  return parts.join(' ');
}

export function collectLinks(nodes: Element[], page: URL, follow: boolean, querySpecific = false): LinkPage {
  const targets = new Set<string>(), candidates = new Set<string>(), links = new Map<string, Link>();
  let mailto = 0, tel = 0, overflow = 0, invalid = 0;
  const baseElement = nodes.find((el) => el.tagName === 'base' && attr(el, 'href') !== undefined);
  const base = URL.parse(baseElement ? attr(baseElement, 'href')! : page.href, page) ?? page;
  const navigation = new Set<Element>();
  const mains = new Set<Element>();
  for (const el of nodes) {
    const parent = el.parentNode && 'tagName' in el.parentNode ? el.parentNode : null;
    if (el.tagName === 'nav' || attr(el, 'role') === 'navigation' || (parent && navigation.has(parent))) navigation.add(el);
    if (el.tagName === 'main' || attr(el, 'role') === 'main' || (parent && mains.has(parent))) mains.add(el);
    const id = attr(el, 'id');
    if (id) targets.add(id);
    if (el.tagName !== 'a') continue;
    const named = attr(el, 'name');
    if (named) targets.add(named);
    const href = attr(el, 'href');
    if (href === undefined) continue;
    const url = URL.parse(href, base);
    if (!url) { invalid++; continue; }
    if (url.protocol === 'mailto:') { mailto++; continue; }
    if (url.protocol === 'tel:') { tel++; continue; }
    const name = linkText(el);
    const primary = attr(el, 'data-cta') !== undefined || /(?:^|[\s_-])(primary|cta|btn|button)(?:$|[\s_-])/i.test(attr(el, 'class') || '') ||
      mains.has(el) && /\b(get started|contact us|sign up|book|buy|learn more|request a demo|start trial)\b/i.test(name);
    const kind = primary ? 'Main CTA' : navigation.has(el) ? 'Navigation' : 'Internal link';
    if (url.origin !== page.origin && kind === 'Internal link') continue;
    const destination = new URL(url.href);
    destination.hash = '';
    // Saved URLs omit queries. Only a relative fragment without a base override is certainly on a query-specific document.
    const local = destination.href === page.href && (!querySpecific || (!baseElement && href.trim().startsWith('#')));
    let skip: string | undefined;
    if (url.origin !== page.origin) skip = 'The destination leaves the authorised origin.';
    else if (!eligibleLink(url, page.origin, false) || /\b(delete|remove|submit|pay|buy|purchase|send|log\s*out|sign\s*out|unsubscribe)\b/i.test(name))
      skip = 'The address or action fell outside the safe, credential-free link policy.';
    else if (attr(el, 'download') !== undefined) skip = 'The link requests a download.';
    else if (!local && (!follow || /\bnofollow\b/i.test(attr(el, 'rel') || ''))) skip = 'Published nofollow instructions exclude this link.';
    if (!skip && !local && eligibleLink(url, page.origin) && candidates.size < LINK_LIMIT) candidates.add(destination.href);
    const key = kind + '\n' + url.href;
    const existing = links.get(key);
    if (existing && (!existing.skip || skip)) continue;
    if (!existing && links.size >= LINK_LIMIT) { overflow++; continue; }
    links.set(key, { url, kind, skip, local, fragment: url.href.includes('#') });
  }
  return { page: page.href, targets, links: [...links.values()], follow, candidates: [...candidates], overflow, invalid, mailto, tel };
}

export function includeRenderedLinks(delivered: LinkPage, rendered: LinkPage) {
  const known = new Set(delivered.links.map((link) => link.kind + '\n' + link.url.href));
  delivered.targets = rendered.targets;
  delivered.partial = rendered.partial;
  delivered.mailto = Math.max(delivered.mailto, rendered.mailto);
  delivered.tel = Math.max(delivered.tel, rendered.tel);
  delivered.invalid = Math.max(delivered.invalid, rendered.invalid);
  delivered.overflow = Math.max(delivered.overflow, rendered.overflow);
  for (const link of rendered.links) {
    if (known.has(link.kind + '\n' + link.url.href)) continue;
    if (delivered.links.length < LINK_LIMIT) delivered.links.push(link);
    else delivered.overflow++;
  }
}

function checkFragment(link: Link, path: string, response: LinkResponse | undefined, key: string, add: Add) {
  const hash = link.url.hash.slice(1);
  const label = /^[a-z][\w.:-]{0,79}$/i.test(hash) ? '#' + hash : '(fragment)';
  const title = 'Anchor target ' + label + ' on ' + path.slice(0, 160);
  if (!response?.targets || hash.includes(':~:text=')) {
    add(key, title, null, 'This destination has no inspected HTML target set or uses a browser text fragment.');
    return;
  }
  try {
    const id = decodeURIComponent(hash);
    const found = !id || id.toLowerCase() === 'top' || response.targets.has(id);
    add(key, title, found || (response.partial ? null : false), found ? 'The captured document provides this fragment destination.' :
      response.partial ? 'No matching target was observed in the incomplete replay.' : 'The inspected document contained no matching ID or named anchor.');
  } catch {
    add(key, title, null, 'The fragment could not be decoded.');
  }
}

export async function probeLinks(
  pages: LinkPage[], responses: Map<string, LinkResponse>, read: PageReader, signal: AbortSignal,
  policy: LinkPolicy | undefined, remaining: number,
) {
  if (!policy) return remaining;
  for (const page of pages) {
    const origin = new URL(page.page).origin;
    for (const link of page.links) {
      if (remaining <= 0 || signal.aborted) return remaining;
      const url = new URL(link.url.href);
      url.hash = '';
      if (link.skip || link.local || responses.has(url.href) || !eligibleLink(url, origin, false) || !policy.allowed(url)) continue;
      const allowUrl = (u: URL) => eligibleLink(u, origin, false) && policy.allowed(u);
      try {
        for (const method of ['HEAD', 'GET'] as const) {
          remaining--;
          await delay(policy.waitMs, undefined, { signal });
          const result = await read(url, { origin, signal, statusOnly: method, allowUrl });
          const final = !result.hadQuery && result.status >= 200 && result.status < 300 ? responses.get(result.url) : undefined;
          responses.set(url.href, { targets: final?.targets, partial: final?.partial, status: result.status, method });
          if (remaining <= 0 || signal.aborted || ![405, 501].includes(result.status)) break;
        }
      } catch (error) {
        if (!(error instanceof HealthReadError) && !signal.aborted) throw error;
        responses.set(url.href, { status: null, reason: signal.aborted ? 'The shared capture deadline was reached.' : (error as HealthReadError).message });
      }
    }
  }
  return remaining;
}

export function recordLinks(pages: LinkPage[], responses: Map<string, LinkResponse>, follow: boolean, policy: LinkPolicy | undefined, checks: Check[]) {
  for (const page of pages) {
    const resolved = new Set<string>();
    const add: Add = (key, title, passed, detail) => checks.push({
      key: digest(page.page + '\n' + key).slice(0, 24), category: 'core_journeys', title, passed, detail,
      source: 'website', page: page.page, recommendation: 'Review the destination and repeat the signed-out navigation check.',
    });
    for (const scheme of ['mailto', 'tel'] as const) {
      if (page[scheme]) add(scheme, scheme + ' links present', true, page[scheme] + ' ' + scheme + ' link(s) appeared on the inspected page. No handler was opened.');
    }
    if (page.overflow || page.invalid) add('remaining-links', 'Links outside the address sample', null,
      page.overflow + ' reference(s) exceeded the ' + LINK_LIMIT + '-link detail limit and ' + page.invalid + ' could not be parsed.');
    for (const link of page.links) {
      const url = new URL(link.url.href);
      url.hash = '';
      const key = link.kind + '\n' + link.url.href;
      const path = link.skip && (url.username || url.password || url.search || url.origin !== new URL(page.page).origin) ? '(restricted address)' : url.pathname;
      const title = link.kind + ' to ' + path.slice(0, 160);
      const response: LinkResponse | undefined = link.local ? { status: 200, targets: page.targets, partial: page.partial } : responses.get(url.href);
      let reason = link.skip;
      if (!reason && !link.local && !follow) reason = 'Link following was switched off.';
      if (!reason && !response) {
        if (!policy) reason = 'A usable crawl policy was unavailable.';
        else if (!policy.allowed(url)) reason = 'The published robots policy excludes this destination.';
        else reason = 'The link-read count or shared capture deadline was reached.';
      }
      const status = response?.status;
      const restricted = status != null && [401, 403, 405, 429, 501].includes(status);
      const routeKey = link.kind + '\n' + url.href + '\n' + (reason ?? '');
      if ((!link.local || !link.fragment || reason) && !resolved.has(routeKey)) {
        resolved.add(routeKey);
        add(routeKey, title, reason || status == null || restricted ? null : status >= 200 && status < 300,
          reason || response?.reason || (status == null ? 'The destination was not observed.' :
            'The signed-out ' + (response?.method ?? 'GET') + ' returned HTTP ' + status + '.' + (restricted ? ' Public resolution could not be verified.' : '')));
      }
      if (link.fragment) checkFragment(link, path, reason ? undefined : response, key + '-anchor', add);
    }
  }
}
