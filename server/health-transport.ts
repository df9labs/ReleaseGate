import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { HttpError } from './support';

export const healthReadLimits = { timeoutMs: 10_000, bytes: 1024 * 1024, redirects: 3 } as const;
export const healthUserAgent = 'ReleaseGateHealthcheck/1.0';
// Only browser asset capture and offline replay use these exact HTTPS origins.
export const trustedAssetHosts = [
  'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com',
  'fonts.gstatic.com', 'ajax.googleapis.com', 'code.jquery.com',
] as const;
export function trustedAssetOrigin(url: URL) {
  return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
    trustedAssetHosts.some((host) => host === url.hostname);
}
export const isFontType = (type: string) => /^font\/(?:woff2?|ttf|otf)$/.test(type);
const scriptTypes = new Set(['text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript']);
export const isScriptType = (type: string) => scriptTypes.has(type);
export type PublicPage = {
  url: string; status: number; contentType: string; body: string;
  contentSecurityPolicy?: string;
  robotsTag?: string;
  hadQuery?: boolean;
  fontBytes?: Buffer;
  allowOrigin?: string;
  releaseHeaders?: ReturnType<typeof readReleaseHeaders>;
};
export function readReleaseHeaders(get: (name: string) => string | undefined) {
  const hsts = get('strict-transport-security') ?? '';
  const ages = hsts.split(';').map((part) => part.trim()).filter((part) => /^max-age\b/i.test(part));
  const age = ages.length === 1 && /^max-age\s*=\s*(?:"(\d+)"|(\d+))$/i.exec(ages[0]);
  const security = [
    get('content-security-policy')?.trim() && 'Content-Security-Policy',
    get('x-content-type-options')?.trim().toLowerCase() === 'nosniff' && 'X-Content-Type-Options (nosniff)',
    /^(deny|sameorigin)$/i.test(get('x-frame-options')?.trim() ?? '') && 'X-Frame-Options',
    get('referrer-policy')?.trim() && 'Referrer-Policy',
    get('permissions-policy')?.trim() && 'Permissions-Policy',
  ].filter((name): name is string => !!name);
  const build: string[] = [];
  for (const header of ['x-build-id', 'x-build-version', 'x-app-version', 'x-release-version', 'x-version', 'x-revision']) {
    const value = get(header)?.trim();
    if (value && /^[\w.+@/-]{1,80}$/.test(value)) build.push(header + ' ' + value);
  }
  return { hsts: !!age && Number(age[1] ?? age[2]) > 0, security, build };
}
type Failure = 'policy' | 'network' | 'timeout' | 'limit' | 'format' | 'cancelled';

export class HealthReadError extends HttpError {
  constructor(
    readonly kind: Failure,
    message: string,
  ) {
    super(kind === 'timeout' ? 504 : kind === 'network' ? 502 : 422, message);
  }
}

const deny = (reason: string) => new HealthReadError('policy', reason);
const tooLarge = () => new HealthReadError('limit', 'The response exceeded the 1 MiB page limit.');
const networkError = () =>
  new HealthReadError('network', 'ReleaseGate could not reach the page or verify its connection.');
const privateQuery =
  /(?:token|password|passwd|secret|signature|credential|session|authorization|api[_-]?key|^key$|^code$|^state$|^sig$|^auth$|^jwt$)/i;
const redirects = new Set([301, 302, 303, 307, 308]);
const publicV6 = ipaddr.IPv6.parse('2000::');

function eligibleAddress(address: string) {
  if (address.includes('%') || !isIP(address)) return false;
  const ip = ipaddr.parse(address);
  if (ip.range() !== 'unicast') return false;
  return ip.kind() === 'ipv4' || ip.match(publicV6, 3);
}

function hostname(url: URL) {
  return url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function checkTarget(url: URL, requiredOrigin?: string) {
  if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password)
    throw deny('Use a public HTTP or HTTPS page on its standard port, without embedded credentials.');
  if ([...url.searchParams.keys()].some((key) => privateQuery.test(key)))
    throw deny('Remove sign-in, session or private key parameters from the page URL.');
  if (requiredOrigin && url.origin !== requiredOrigin)
    throw deny('This link leaves the authorised website origin.');
  const host = hostname(url);
  if (
    !isIP(host) &&
    (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|onion|test|invalid|home\.arpa)$/.test(host))
  )
    throw deny('Enter a publicly reachable website. Private network targets are excluded.');
}

async function addresses(host: string, signal: AbortSignal): Promise<LookupAddress[]> {
  signal.throwIfAborted();
  const family = isIP(host);
  const results = family
    ? [{ address: host, family }]
    : await new Promise<LookupAddress[]>((resolve, reject) => {
        // System DNS lookups cannot be cancelled. Stop waiting and discard any late result.
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        dns
          .lookup(host, { all: true, verbatim: true })
          .then(resolve, reject)
          .finally(() => signal.removeEventListener('abort', abort));
      });
  if (!results.length) throw networkError();
  if (!results.every((entry) => eligibleAddress(entry.address)))
    throw deny('The website address must resolve exclusively to public internet addresses.');
  return results;
}

function pinnedLookup(records: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const available =
      options.family === 4 || options.family === 6
        ? records.filter((record) => record.family === options.family)
        : records;
    if (!available.length) return callback(new Error('Address family unavailable'), '');
    if (options.all) callback(null, available);
    else callback(null, available[0].address, available[0].family);
  };
}

type ReadOptions = {
  signal?: AbortSignal; origin?: string; allowUrl?: (target: URL) => boolean; asset?: boolean;
  statusOnly?: 'HEAD' | 'GET'; sitemap?: boolean; releaseEvidence?: boolean;
};
async function getResponse(url: URL, signal: AbortSignal, options: ReadOptions): Promise<IncomingMessage> {
  const approved = await addresses(hostname(url), signal);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const requestOptions = {
      method: options.statusOnly ?? 'GET',
      signal,
      lookup: pinnedLookup(approved),
      headers: {
        'user-agent': healthUserAgent,
        accept: options.asset ? 'text/javascript,application/javascript,text/css,font/woff2,font/woff,font/ttf,font/otf' :
          options.sitemap ? 'application/xml,text/xml,text/plain;q=0.8' : 'text/html,application/xhtml+xml,text/plain;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
        connection: 'close',
      },
    };
    // A dedicated agent avoids ambient proxy settings and socket reuse between inspections.
    const request =
      url.protocol === 'https:'
        ? https.get(
            url,
            {
              ...requestOptions,
              agent: new https.Agent({ proxyEnv: {}, keepAlive: false }),
              rejectUnauthorized: true,
            },
            resolve,
          )
        : http.get(url, { ...requestOptions, agent: new http.Agent({ proxyEnv: {}, keepAlive: false }) }, resolve);
    request.once('error', reject);
  });
}

async function readBytes(response: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
  if (Number(response.headers['content-length']) > healthReadLimits.bytes) throw tooLarge();
  const encoding = (response.headers['content-encoding'] || 'identity').toLowerCase().trim();
  const decoders = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };
  if (encoding !== 'identity' && !Object.hasOwn(decoders, encoding))
    throw new HealthReadError('format', 'The website used an unsupported response encoding.');
  let received = 0;
  const wireLimit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      received += chunk.length;
      done(received > healthReadLimits.bytes ? tooLarge() : null, chunk);
    },
  });
  const chunks: Buffer[] = [];
  let decoded = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      decoded += chunk.length;
      if (decoded > healthReadLimits.bytes) return done(tooLarge());
      chunks.push(chunk);
      done();
    },
  });
  if (encoding === 'identity') await pipeline(response, wireLimit, sink, { signal });
  else await pipeline(response, wireLimit, decoders[encoding as keyof typeof decoders](), sink, { signal });
  return Buffer.concat(chunks, decoded);
}

function decodeText(bytes: Buffer, response: IncomingMessage) {
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(response.headers['content-type'] || '')?.[1];
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset || 'utf-8');
  } catch {
    throw new HealthReadError('format', 'The website used an unsupported text character set.');
  }
  return decoder.decode(bytes);
}

export async function readPublicPage(
  initial: URL,
  options: ReadOptions = {},
): Promise<PublicPage> {
  let url = new URL(initial.href);
  url.hash = '';
  const timeout = AbortSignal.timeout(healthReadLimits.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    for (let hop = 0; ; hop++) {
      checkTarget(url, options.asset && trustedAssetOrigin(url) ? undefined : options.origin);
      if (options.allowUrl && !options.allowUrl(url))
        throw deny('This destination is outside the permitted paths for this review.');
      const response = await getResponse(url, signal, options);
      try {
        const status = response.statusCode || 0;
        if (redirects.has(status) && response.headers.location) {
          if (hop === healthReadLimits.redirects)
            throw new HealthReadError('limit', 'The website exceeded the three-redirect limit.');
          let next: URL;
          try {
            next = new URL(response.headers.location, url);
          } catch {
            throw new HealthReadError('format', 'The website returned an invalid redirect.');
          }
          if (url.protocol === 'https:' && next.protocol !== 'https:')
            throw deny('The website redirected away from HTTPS.');
          if (hostname(next).replace(/^www\./, '') !== hostname(initial).replace(/^www\./, ''))
            throw deny(
              'The website redirected to a different site. Enter the intended public destination directly.',
            );
          next.hash = '';
          url = next;
          continue;
        }
        const contentType = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const text = options.asset
          ? isScriptType(contentType) || contentType === 'text/css'
          : options.sitemap ? ['application/xml', 'text/xml', 'text/plain'].includes(contentType)
          : ['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType);
        const policy = response.headers['content-security-policy'];
        const robots = response.headers['x-robots-tag'];
        const allowOrigin = response.headers['access-control-allow-origin'];
        const font = options.asset && isFontType(contentType);
        return {
          url: url.origin + url.pathname,
          status,
          contentType,
          body: text && !options.statusOnly ? decodeText(await readBytes(response, signal), response) : '',
          ...(options.releaseEvidence ? { releaseHeaders: readReleaseHeaders((name) => {
            const value = response.headers[name];
            return Array.isArray(value) ? value.join(', ') : value;
          }) } : {}),
          ...(font ? { fontBytes: await readBytes(response, signal) } : {}),
          ...(options.asset && typeof allowOrigin === 'string' ? { allowOrigin } : {}),
          ...(url.search ? { hadQuery: true } : {}),
          ...(policy ? { contentSecurityPolicy: Array.isArray(policy) ? policy.join(', ') : policy } : {}),
          ...(robots ? { robotsTag: Array.isArray(robots) ? robots.join(', ') : robots } : {}),
        };
      } finally {
        response.destroy();
      }
    }
  } catch (error) {
    if (timeout.aborted)
      throw new HealthReadError('timeout', 'The website did not respond within ten seconds.');
    if (options.signal?.aborted)
      throw new HealthReadError('cancelled', 'The review stopped before the page could be read.');
    if (error instanceof HealthReadError) throw error;
    throw networkError();
  }
}
