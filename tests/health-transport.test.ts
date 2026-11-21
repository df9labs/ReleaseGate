import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { gzipSync } from 'node:zlib';
import {
  healthReadLimits,
  healthUserAgent,
  HealthReadError,
  readPublicPage,
  trustedAssetHosts,
  trustedAssetOrigin,
} from '../server/health-transport';

const publicHost = 'http://review.example.org';
const publicIP = { address: '1.1.1.1', family: 4 };
const hasKind = (kind: HealthReadError['kind']) => (e: unknown) =>
  e instanceof HealthReadError && e.kind === kind;

// Intercept at the Node HTTP boundary, after the production reader has validated DNS.
// The fixture checks the exact socket lookup passed to Node, then delivers a real HTTP response over loopback.
async function localOrigin(
  t: TestContext,
  handle: http.RequestListener,
  answers: () => LookupAddress[] = () => [publicIP],
) {
  const server = http.createServer(handle);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const lookup = t.mock.method(dns, 'lookup', async () => answers());
  const originalGet = http.get;
  const requests: string[] = [];
  t.mock.method(
    http,
    'get',
    (url: URL, options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
      requests.push(url.href);
      assert.ok(options.lookup);
      options.lookup(url.hostname, { all: true }, (error, values) => {
        assert.ifError(error);
        assert.deepEqual(values, [publicIP]);
      });
      return originalGet(
        new URL(url.pathname + url.search, 'http://127.0.0.1:' + address.port),
        {
          method: options.method,
          signal: options.signal,
          headers: options.headers,
        },
        callback,
      );
    },
  );
  return { requests, lookup };
}

test('reader follows a same-site redirect, pins each hop and returns observed HTTP bytes', async (t) => {
  const { requests, lookup } = await localOrigin(t, (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.headers['user-agent'], healthUserAgent);
    assert.equal(req.headers.authorization, undefined);
    assert.equal(req.headers.cookie, undefined);
    if (req.url === '/') {
      res.writeHead(301, {
        Location: 'http://www.review.example.org/about?lang=en#intro',
        'Set-Cookie': 'sample=yes',
      });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' });
      res.end(gzipSync('<title>DF9 — sample</title>'));
    }
  });
  assert.deepEqual(await readPublicPage(new URL(publicHost)), {
    url: 'http://www.review.example.org/about',
    hadQuery: true,
    status: 200,
    contentType: 'text/html',
    body: '<title>DF9 — sample</title>',
  });
  assert.equal(lookup.mock.callCount(), 2);
  assert.equal(requests[1], 'http://www.review.example.org/about?lang=en');
});

test('reader rejects unsupported schemes, embedded credentials, private and reserved addresses before any connection', async (t) => {
  const { requests, lookup } = await localOrigin(
    t,
    (_req, res) => res.end(),
    () => [publicIP, { address: '192.168.1.20', family: 4 }],
  );
  const targets = [
    'file:///app/data',
    'http://internal/',
    'https://one.localhost/',
    'http://127.0.0.1/',
    'http://169.254.169.254/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
    'http://[2001:db8::1]/',
    'http://[fec0::1]/',
    'http://user:secret@review.example.org/',
    publicHost + ':8080/',
    publicHost + '/?access_token=hidden',
    publicHost,
  ];
  for (const target of targets) await assert.rejects(readPublicPage(new URL(target)), hasKind('policy'));
  assert.equal(requests.length, 0);
  assert.equal(lookup.mock.callCount(), 1);
});

test('a redirect must resolve afresh and stay on the authorised origin', async (t) => {
  let location = '/second';
  let nextAnswer = [publicIP];
  const fixture = await localOrigin(
    t,
    (_req, res) => {
      nextAnswer = [{ address: '10.0.0.3', family: 4 }];
      res.writeHead(302, { Location: location }).end();
    },
    () => nextAnswer,
  );
  await assert.rejects(readPublicPage(new URL(publicHost)), hasKind('policy'));
  assert.equal(fixture.requests.length, 1);
  nextAnswer = [publicIP];
  location = 'http://www.review.example.org/next';
  await assert.rejects(readPublicPage(new URL(publicHost), { origin: publicHost }), hasKind('policy'));
  nextAnswer = [publicIP];
  location = 'https://another.example.org';
  await assert.rejects(readPublicPage(new URL(publicHost)), hasKind('policy'));
  assert.equal(fixture.requests.length, 3);
});

test('reader limits redirected requests and both wire and decoded body sizes', async (t) => {
  const expanded = Buffer.alloc(healthReadLimits.bytes + 1, 65);
  const { requests } = await localOrigin(t, (req, res) => {
    if (req.url === '/loop') return res.writeHead(302, { Location: '/loop' }).end();
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/zipped')
      return res.writeHead(200, { 'Content-Encoding': 'gzip' }).end(gzipSync(expanded));
    res.writeHead(200, { 'Transfer-Encoding': 'chunked' });
    res.end(expanded);
  });
  await assert.rejects(readPublicPage(new URL('/loop', publicHost)), hasKind('limit'));
  assert.equal(requests.length, healthReadLimits.redirects + 1);
  await assert.rejects(readPublicPage(new URL('/wire', publicHost)), hasKind('limit'));
  await assert.rejects(readPublicPage(new URL('/zipped', publicHost)), hasKind('limit'));
});

test('the crawl path policy checks same-origin redirects before DNS or a second GET', async (t) => {
  const { requests, lookup } = await localOrigin(t, (_req, res) =>
    res.writeHead(302, { Location: '/blocked-by-robots' }).end(),
  );
  await assert.rejects(
    readPublicPage(new URL('/public', publicHost), {
      origin: publicHost,
      allowUrl: (u) => u.pathname === '/public',
    }),
    hasKind('policy'),
  );
  assert.deepEqual(requests, [publicHost + '/public']);
  assert.equal(lookup.mock.callCount(), 1);
});

test('only browser assets may cross to an exact trusted HTTPS origin and cannot redirect off it', async (t) => {
  const fixture = await localOrigin(t, (req, res) => {
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(302, { Location: 'https://unlisted.example/next.js' }).end();
  });
  t.mock.method(https, 'get', http.get);
  assert.deepEqual([...trustedAssetHosts].sort(), ['ajax.googleapis.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com',
    'code.jquery.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com']);
  for (const host of trustedAssetHosts) assert.ok(trustedAssetOrigin(new URL('https://' + host)));
  const asset = new URL('https://unpkg.com/test.js');
  await assert.rejects(readPublicPage(asset, { origin: publicHost }), hasKind('policy'));
  for (const target of ['http://unpkg.com/a.js', 'https://www.unpkg.com/a.js', 'https://unpkg.com:8443/a.js', 'https://key@unpkg.com/a.js'])
    await assert.rejects(readPublicPage(new URL(target), { origin: publicHost, asset: true }), hasKind('policy'));
  await assert.rejects(readPublicPage(asset, { origin: publicHost, asset: true }), hasKind('policy'));
  assert.deepEqual(fixture.requests, [asset.href]);
  assert.equal(fixture.lookup.mock.callCount(), 1);
});

test('an allowed CDN resolving to a mixture of public and private addresses opens no connection', async (t) => {
  t.mock.method(dns, 'lookup', async () => [publicIP, { address: '127.0.0.1', family: 4 }]);
  const get = t.mock.method(https, 'get', () => { throw new Error('Unexpected connection'); });
  await assert.rejects(readPublicPage(new URL('https://cdn.jsdelivr.net/ui.js'), { asset: true, origin: publicHost }), hasKind('policy'));
  assert.equal(get.mock.callCount(), 0);
});

test('reader preserves failure status, omits binary content and safely aborts outstanding I/O', async (t) => {
  await localOrigin(t, (req, res) => {
    if (req.url === '/slow') return;
    res.writeHead(404, { 'Content-Type': 'image/png' }).end('example image bytes');
  });
  assert.deepEqual(await readPublicPage(new URL(publicHost)), {
    url: publicHost + '/',
    status: 404,
    body: '',
    contentType: 'image/png',
  });
  await assert.rejects(
    readPublicPage(new URL('/slow', publicHost), { signal: AbortSignal.timeout(30) }),
    hasKind('cancelled'),
  );
});

test('status checks use the requested method without reading a body, and release reads retain selected header evidence', async (t) => {
  const methods: string[] = [];
  await localOrigin(t, (req, res) => {
    methods.push(req.method!);
    if (req.url === '/sitemap.xml') return res.writeHead(200, { 'Content-Type': 'text/xml' }).end('<urlset/>');
    res.writeHead(200, { 'Content-Type': 'text/html', 'X-Build-Id': 'rc-7', 'Strict-Transport-Security': 'max-age=0',
      'X-Frame-Options': 'DENY', 'Set-Cookie': 'private=secret' }).end('<main>Page</main>');
  });
  const target = new URL(publicHost);
  for (const method of ['HEAD', 'GET'] as const) assert.equal((await readPublicPage(target, { statusOnly: method })).body, '');
  const page = await readPublicPage(target, { releaseEvidence: true });
  assert.deepEqual(page.releaseHeaders, { hsts: false, security: ['X-Frame-Options'], build: ['x-build-id rc-7'] });
  assert.doesNotMatch(JSON.stringify(page), /secret/);
  assert.equal((await readPublicPage(new URL('/sitemap.xml', target), { sitemap: true })).body, '<urlset/>');
  assert.deepEqual(methods, ['HEAD', 'GET', 'GET', 'GET']);
});

test('the deadline includes DNS, and a late answer cannot open a socket', async (t) => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', () => timeout(10));
  t.mock.method(dns, 'lookup', async () => {
    await delay(30);
    return [publicIP];
  });
  const send = t.mock.method(http, 'get', () => {
    throw new Error('Unexpected network activity');
  });
  await assert.rejects(readPublicPage(new URL(publicHost)), hasKind('timeout'));
  await delay(35);
  assert.equal(send.mock.callCount(), 0);
});
