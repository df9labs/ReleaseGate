import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_LIMIT, loadBrowserAssets } from '../server/health-assets';
import type { PageReader } from '../server/health-pages';

const start = 'https://owned.example/';
const page = (body: string) => ({ url: start, body, status: 200, contentType: 'text/html' });

test('replay assets use only observed same-origin script and style URLs and honour crawl rules', async () => {
  const calls: string[] = [];
  const read: PageReader = async (url, options) => {
    calls.push(url.pathname + url.search);
    assert.equal(options?.origin, new URL(start).origin);
    assert.equal(options?.allowUrl?.(new URL('https://other.example/app.js')), false);
    if (url.pathname === '/robots.txt') return { url: url.href, status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /private' };
    assert.equal(options?.asset, true);
    return { url: url.href, status: 200, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : 'text/css', body: '/* observed */' };
  };
  const site = page('<base href="/assets/"><script src="app.js?v=2"></script><script src="app.js?v=2"></script>' +
    '<script src="/private/ui.js"></script><link rel="stylesheet" href="style.css"><script src="https://other.example/app.js"></script>' +
    '<script src="/write"></script><script src="/logout/app.js"></script><script src="app.js?token=secret"></script><noscript><script src="no.js"></script></noscript>');
  const replay = await loadBrowserAssets([site], read, AbortSignal.timeout(6000));
  assert.deepEqual(calls, ['/robots.txt', '/assets/app.js?v=2', '/assets/style.css']);
  assert.equal(replay.assets.size, 2);
  assert.deepEqual([...replay.assets.keys()], [start+'assets/app.js?v=2',start+'assets/style.css']);
  assert.ok(replay.limitations.length > 0);
  assert.ok(!replay.limitations.join(' ').includes('token='));
});

test('unavailable crawl rules or a long delay skip assets without losing static evidence', async () => {
  for (const [status, body] of [[503, ''], [200, 'User-agent: *\nCrawl-delay: 3000000'], [200, 'Maintenance in progress']] as const) {
    const calls: string[] = [];
    const result = await loadBrowserAssets([page('<script src="/ui.js"></script>')], async (u) => {
      calls.push(u.pathname);
      return { url: u.href, status, contentType: 'text/plain', body };
    }, AbortSignal.timeout(1000));
    assert.deepEqual(calls, ['/robots.txt']);
    assert.equal(result.assets.size, 0);
    assert.ok(result.limitations.length);
  }
});

test('declared assets and module imports share the asset-read budget, including wrong-MIME attempts', async () => {
  let attempts = 0;
  const cdn = 'https://cdn.jsdelivr.net/npm/@scope/example@1.0.0';
  const markup = '<script type="module" src="' + cdn + '"></script><script src="https://unpkg.com/not-script@1"></script>' +
    Array.from({ length: ASSET_LIMIT - 3 }, (_, i) => '<script src="/local-' + i + '.js"></script>').join('');
  const report = await loadBrowserAssets([page(markup)], async (url) => {
    if (url.pathname === '/robots.txt') return { ...page(''), url: url.href, status: 404, contentType: 'text/plain' };
    attempts++;
    const body = url.href === cdn ? 'import "/first.js"; import "/second.js";' : '/* asset */';
    return { ...page(body), url: url.href, contentType: url.hostname === 'unpkg.com' ? 'text/html' : 'text/javascript' };
  }, AbortSignal.timeout(45_000));
  assert.equal(attempts, ASSET_LIMIT);
  assert.ok(report.assets.has(cdn));
  assert.equal(report.assets.size, ASSET_LIMIT - 1);
  assert.equal(report.assets.has('https://unpkg.com/not-script@1'), false);
  assert.ok(report.assets.has('https://cdn.jsdelivr.net/first.js'));
  assert.equal(report.assets.has('https://cdn.jsdelivr.net/second.js'), false);
  assert.match(report.limitations.join(' '), new RegExp(ASSET_LIMIT + '-read asset budget was exhausted'));
  assert.match(report.limitations.join(' '), /eligible asset URLs/);
});

test('trusted HTTPS assets use each host’s crawl policy and share a cache across pages', async () => {
  const cdn = 'https://cdn.jsdelivr.net';
  const css = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap';
  const font = 'https://fonts.gstatic.com/s/inter/v1/latin.woff2';
  const calls: string[] = [];
  const read: PageReader = async (url, options) => {
    calls.push(url.href);
    assert.equal(options?.allowUrl?.(new URL('https://unlisted.example/app.js')), false);
    if (url.pathname === '/robots.txt') {
      assert.equal(options?.origin, url.origin);
      return { url: url.href, status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /private/' };
    }
    assert.equal(options?.origin, new URL(start).origin);
    assert.equal(options?.asset, true);
    if (url.href === css) return { ...page('@font-face{src:url("' + font + '")}'), contentType: 'text/css' };
    if (url.href === font) return { ...page(''), contentType: 'font/woff2', fontBytes: Buffer.from([0, 255]), allowOrigin: '*' };
    return { ...page('/* captured */'), contentType: 'application/javascript' };
  };
  const site = page('<script src="' + cdn + '/a.js"></script><link rel="stylesheet" href="' + css + '">' +
    ['http://cdn.jsdelivr.net/a.js', cdn + ':8443/b.js', 'https://cdn.jsdelivr.net.other.example/b.js',
      'https://secret@cdn.jsdelivr.net/b.js', cdn + '/private/b.js', cdn + '/api/delete.js',
      cdn + '/a.js?token=secret'].map((url) => '<script src="' + url + '"></script>').join(''));
  const captured = await loadBrowserAssets([site, site], read, AbortSignal.timeout(5000));
  assert.deepEqual([...captured.assets.keys()], [cdn + '/a.js', css, font]);
  assert.deepEqual(captured.assets.get(font)?.body, Buffer.from([0, 255]));
  assert.deepEqual(calls, [cdn + '/robots.txt', cdn + '/a.js', 'https://fonts.googleapis.com/robots.txt',
    css, 'https://fonts.gstatic.com/robots.txt', font]);
  assert.ok(!captured.limitations.join(' ').includes('secret'));
});
