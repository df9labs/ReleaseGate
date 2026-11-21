import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { setImmediate as yieldToEventLoop, setTimeout as delay } from 'node:timers/promises';
import type { PageReader } from './health-pages';
import { readCrawlPolicy } from './health-crawl';
import { HealthReadError, isFontType, isScriptType, trustedAssetOrigin, type PublicPage } from './health-transport';
import { sourceDependencies, type AssetKind, type Dependencies, type SourceKind } from './health-asset-imports';
import { PageImportMap } from './health-import-map';

export const ASSET_LIMIT = 80;
export const ASSET_IMPORT_DEPTH = 4;
export type BrowserAsset = { body: string | Buffer; contentType: string; allowOrigin?: string };
type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const attr = (node: Element, key: string) => node.attrs.find((a) => a.name === key)?.value;

function permittedAsset(url: URL, origin: string, kind: AssetKind) {
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
  if (url.origin !== origin && !trustedAssetOrigin(url)) return false;
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { return false; }
  if (/(?:^|[\/._-])(?:admin|reset|logout|delete|checkout|callback|token)(?:$|[\/._-])/i.test(path)) return false;
  if (kind === 'stylesheet' && url.origin === 'https://fonts.googleapis.com' && /^\/css2?$/.test(path)) {
    return url.searchParams.has('family') && [...url.searchParams].every(([key, val]) =>
      ['family', 'display', 'subset'].includes(key) && /^[\w .:,;@|+-]{1,64}$/.test(val));
  }
  if ([...url.searchParams].some(([key, val]) => !/^(v|ver|version|hash)$/i.test(key) || !/^[\w.-]{1,64}$/.test(val))) return false;
  if (kind === 'font') {
    if (url.origin === 'https://fonts.gstatic.com' && (!/^\/s\/[\w./-]+$/.test(path) || url.search)) return false;
    return /\.(?:woff2?|ttf|otf)$/i.test(path);
  }
  if (kind === 'stylesheet') return /\.css$/i.test(path);
  if (/\.m?js$/i.test(path)) return true;
  const packagePath = url.origin === 'https://cdn.jsdelivr.net' && path.startsWith('/npm/') ? path.slice(5) :
    url.origin === 'https://unpkg.com' ? path.slice(1) : '';
  return /^(?:@[\w.-]+\/)?[\w-][\w.-]*(?:@[\w.-]+)?(?:\/\+esm)?\/?$/.test(packagePath);
}

function mediaMatches(type: string, kind: AssetKind) {
  if (kind === 'font') return isFontType(type);
  return kind === 'stylesheet' ? type === 'text/css' : isScriptType(type);
}

type PageContext = { map: PageImportMap; seen: Set<string> };
type Source = { base: URL; kind: SourceKind; body: string; depth: number; context: PageContext; cacheKey?: string };
type Root = { kind: AssetKind; url: URL | null } | { kind: SourceKind; base: URL; body: string };

function documentAssets(page: PublicPage) {
  const roots: Root[] = [], externalMaps: (URL | null)[] = [];
  const context: PageContext = { map: new PageImportMap(), seen: new Set() };
  let invalidMaps = 0;
  const documentUrl = new URL(page.url);
  let base = documentUrl, foundBase = false;
  const pending: Node[] = [parse(page.body)];
  while (pending.length) {
    const node = pending.pop()!;
    if ('tagName' in node) {
      if (node.tagName === 'template' || node.tagName === 'noscript') continue;
      if (node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
        const href = attr(node, 'href'), type = (attr(node, 'type') ?? '').trim().toLowerCase();
        if (node.tagName === 'base' && !foundBase && href !== undefined) {
          foundBase = true;
          base = URL.parse(href, documentUrl) ?? documentUrl;
        } else if (node.tagName === 'script' || node.tagName === 'style') {
          const src = attr(node, 'src');
          const body = node.childNodes.map((n) => 'value' in n ? n.value : '').join('');
          if (node.tagName === 'style') {
            if (!type || type === 'text/css') roots.push({ kind: 'stylesheet', base, body });
          } else if (type === 'importmap') {
            if (src !== undefined) externalMaps.push(URL.parse(src, base));
            else if (!context.map.addInline(body, base)) invalidMaps++;
          } else if (type === 'module' || !type || isScriptType(type)) {
            const kind = type === 'module' ? 'module' : 'script';
            if (src === undefined) roots.push({ kind, base, body });
            else if (src.trim()) roots.push({ kind, url: URL.parse(src, base) });
          }
        } else if (node.tagName === 'link' && href) {
          const rel = (attr(node, 'rel') ?? '').toLowerCase().split(/\s+/);
          const url = URL.parse(href, base);
          if (rel.includes('stylesheet')) roots.push({ kind: 'stylesheet', url });
          else if (rel.includes('modulepreload')) roots.push({ kind: 'module', url });
          else if (rel.includes('preload') && attr(node, 'as')?.toLowerCase() === 'font') roots.push({ kind: 'font', url });
        }
      }
    }
    if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
  return { context, roots, invalidMaps, externalMaps };
}

export async function loadBrowserAssets(pages: PublicPage[], read: PageReader, signal: AbortSignal) {
  const assets = new Map<string, BrowserAsset>(), limitations: string[] = [];
  if (!pages.length) return { assets, limitations };
  const origin = new URL(pages[0].url).origin;
  const policies = new Map<string, Awaited<ReturnType<typeof readCrawlPolicy>> | undefined>();
  const eligible = new Set<string>(), fetched = new Map<string, BrowserAsset | undefined>(), sharedSeen = new Set<string>();
  const skippedHosts = new Set<string>(), unavailableHosts = new Set<string>(), depthHosts = new Set<string>();
  const parseHosts = new Set<string>();
  const sources: Source[] = [];
  const parsed = new Map<string, Dependencies | null>();
  let reads = 0, skipped = 0, invalidMaps = 0, externalMaps = 0, unmapped = 0, computed = 0;
  let references = 0;

  async function canContinue() {
    // Cached and rejected references involve no I/O. Let the deadline timer run during long batches.
    if (++references % 256 === 0) await yieldToEventLoop();
    return !signal.aborted;
  }

  function skip(url: URL | null) {
    skipped++;
    if (url?.hostname && ['http:', 'https:'].includes(url.protocol)) skippedHosts.add(url.hostname);
  }

  async function fetchAsset(request: URL): Promise<BrowserAsset | undefined> {
    try {
      if (!policies.has(request.origin)) {
        policies.set(request.origin, undefined);
        const policy = await readCrawlPolicy(request.origin, read, signal);
        policies.set(request.origin, policy);
        if (policy.limitation) limitations.push(request.hostname + ' — ' + policy.limitation);
      }
      const policy = policies.get(request.origin);
      if (!policy || policy.limitation || !policy.allowed(request)) return;
      await delay(policy.waitMs, undefined, { signal });
      reads++;
      const result = await read(request, { origin, signal, asset: true, allowUrl: (u) => u.href === request.href });
      if (result.status < 200 || result.status >= 300) return;
      const type = result.contentType.split(';')[0].trim().toLowerCase();
      if (isScriptType(type) || type === 'text/css' || (isFontType(type) && result.fontBytes?.length))
        return { body: result.fontBytes ?? result.body, contentType: type, allowOrigin: result.allowOrigin };
    } catch (error) {
      if (!(error instanceof HealthReadError) && !signal.aborted) throw error;
    }
  }

  async function capture(url: URL | null, kind: AssetKind, context: PageContext, depth: number) {
    if (!url || !permittedAsset(url, origin, kind)) { skip(url); return; }
    const request = new URL(url.href);
    request.hash = '';
    const href = request.href;
    // Bytes are shared across pages. A module's children can differ by the document's import map.
    const script = kind === 'module' || kind === 'script';
    const seen = script ? context.seen : sharedSeen;
    const identity = kind + '\n' + (script ? url.href : href);
    if (seen.has(identity)) return;
    if (depth > ASSET_IMPORT_DEPTH) { depthHosts.add(url.hostname); return; }
    seen.add(identity);
    eligible.add(href);
    if (!fetched.has(href) && reads < ASSET_LIMIT && !signal.aborted) fetched.set(href, await fetchAsset(request));
    const asset = fetched.get(href);
    if (!asset || !mediaMatches(asset.contentType, kind)) { unavailableHosts.add(url.hostname); return; }
    assets.set(href, asset);
    if (kind !== 'font' && typeof asset.body === 'string')
      sources.push({ base: url, kind, body: asset.body, context, depth, cacheKey: kind + '\n' + href });
  }

  for (const page of pages) {
    if (signal.aborted) break;
    if (new URL(page.url).origin !== origin) { skip(new URL(page.url)); continue; }
    const doc = documentAssets(page);
    invalidMaps += doc.invalidMaps;
    externalMaps += doc.externalMaps.length;
    for (const url of doc.externalMaps) skip(url);
    for (const root of doc.roots) {
      if (!await canContinue()) break;
      if ('url' in root) await capture(root.url, root.kind, doc.context, 0);
      else sources.push({ ...root, context: doc.context, depth: 0 });
    }
  }

  // All document roots are queued before expansion. New sources go to the tail, so the first visit is the shallowest.
  for (const source of sources) {
    if (!await canContinue()) break;
    let deps = source.cacheKey ? parsed.get(source.cacheKey) : undefined;
    if (deps === undefined) {
      try { deps = sourceDependencies(source.kind, source.body); }
      catch { deps = null; parseHosts.add(source.base.hostname); }
      if (source.cacheKey) parsed.set(source.cacheKey, deps);
    }
    if (!deps) continue;
    computed += deps.computed;
    for (const ref of deps.refs) {
      if (!await canContinue()) break;
      const url = ref.kind === 'module' ? source.context.map.resolve(ref.value, source.base) : URL.parse(ref.value, source.base);
      if (ref.kind === 'module' && !url) { unmapped++; continue; }
      await capture(url, ref.kind, source.context, source.depth + 1);
    }
  }

  const hosts = (set: Set<string>) => [...set].sort().join(', ');
  if (skipped) limitations.push(skipped + ' asset reference(s) fell outside the permitted hosts, paths or query rules.' +
    (skippedHosts.size ? ' Affected hosts include ' + hosts(skippedHosts) + '.' : ''));
  if (externalMaps || invalidMaps) limitations.push(externalMaps + ' external and ' + invalidMaps + ' invalid inline import map(s) were skipped.');
  if (unmapped) limitations.push(unmapped + ' module specifier(s) had no usable URL or inline import-map binding.');
  if (computed) limitations.push(computed + ' computed import expression(s) had no literal destination to capture.');
  if (parseHosts.size) limitations.push('Dependency parsing was incomplete for source from ' + hosts(parseHosts) + '.');
  if (depthHosts.size) limitations.push('The ' + ASSET_IMPORT_DEPTH + '-hop import limit excluded deeper dependencies on ' + hosts(depthHosts) + '.');
  if (assets.size < eligible.size) limitations.push(assets.size + ' of ' + eligible.size +
    ' eligible asset URLs were available within the capture limits, MIME checks and published crawl rules. Affected hosts include ' + hosts(unavailableHosts) + '.');
  if (reads === ASSET_LIMIT && fetched.size < eligible.size) limitations.push('The shared ' + ASSET_LIMIT + '-read asset budget was exhausted.');
  if (signal.aborted) limitations.push('The capture deadline or cancellation stopped dependency discovery.');
  return { assets, limitations };
}
