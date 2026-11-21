import assert from 'node:assert/strict';
import test from 'node:test';
import { ASSET_IMPORT_DEPTH, loadBrowserAssets } from '../server/health-assets';
import type { PageReader } from '../server/health-pages';
import type { PublicPage } from '../server/health-transport';

const origin = 'https://preview.example', cdn = 'https://cdn.jsdelivr.net';
const document = (body: string, pathname = '/'): PublicPage => ({ url: origin + pathname, body, status: 200, contentType: 'text/html' });
const timeout = () => AbortSignal.timeout(10_000);
type File = { body: string; contentType: string; fontBytes?: Buffer };

function fixture(files: Record<string, File>, robots = 'User-agent: *\nDisallow: /private/') {
  const fetched: string[] = [], policies: string[] = [];
  const read: PageReader = async (url, options) => {
    assert.equal(options?.allowUrl?.(url), true);
    assert.equal(options?.allowUrl?.(new URL('/different.js', url)), false);
    if (url.pathname === '/robots.txt') {
      assert.equal(options?.origin, url.origin);
      policies.push(url.origin);
      return { url: url.href, status: 200, contentType: 'text/plain', body: robots };
    }
    assert.equal(options?.origin, origin);
    assert.equal(options?.asset, true);
    fetched.push(url.href);
    const file = files[url.href];
    assert.ok(file, 'Unexpected asset read ' + url.href);
    return { url: url.href, status: 200, ...file };
  };
  return { read, fetched, policies };
}

const js = (body: string): File => ({ contentType: 'application/javascript', body });
const css = (body: string): File => ({ contentType: 'text/css', body });

test('module graphs expand breadth-first against each importing URL, with one request per URL even for cycles', async () => {
  const files = {
    [origin + '/js/main.js']: js('import "./shape.js"; export * from "./bridge.js"; const lazy = () => import("lenis");'),
    [origin + '/other.mjs']: js('import "./other-child.js";'),
    [origin + '/js/shape.js']: js('export { station } from "./deep.mjs"; import "./main.js";'),
    [origin + '/js/bridge.js']: js('import "./shape.js";'),
    [cdn + '/npm/lenis@1/+esm']: js('import "./part.mjs";'),
    [origin + '/other-child.js']: js(''),
    [origin + '/js/deep.mjs']: js('export const station = 7;'),
    [cdn + '/npm/lenis@1/part.mjs']: js(''),
  };
  const { read, fetched, policies } = fixture(files);
  const page = document('<script type="importmap">{"imports":{"lenis":"' + cdn + '/npm/lenis@1/+esm"}}</script>' +
    '<link rel="modulepreload" href="/js/main.js"><script type="module" src="/js/main.js"></script>' +
    '<script type="module" src="/other.mjs"></script>');
  const captured = await loadBrowserAssets([page], read, timeout());
  assert.deepEqual(fetched, Object.keys(files));
  assert.deepEqual(policies, [origin, cdn]);
  assert.equal(captured.assets.size, fetched.length);
  assert.deepEqual(captured.limitations, []);
});

test('a shared module expands under each page’s own map and document base, with one network read for its bytes', async () => {
  const files = {
    [origin + '/common.js']: js('import "widget";'),
    [origin + '/first/one.mjs']: js(''),
    [origin + '/second/two.mjs']: js(''),
  };
  const { read, fetched } = fixture(files);
  const page = (dir: string, version: string) => document('<base href="/' + dir + '/">' +
    '<script type="importmap">{"imports":{"widget":"./' + version + '.mjs"}}</script>' +
    '<script type="module">import "/common.js";</script>', '/' + dir + '/home');
  const result = await loadBrowserAssets([page('first', 'one'), page('second', 'two')], read, timeout());
  assert.deepEqual(fetched, Object.keys(files));
  assert.deepEqual(result.limitations, []);
});

test('the depth cap includes four import edges and never excludes a directly declared shorter route', async () => {
  const files: Record<string, File> = {};
  for (let n = 0; n <= ASSET_IMPORT_DEPTH + 1; n++) files[origin + '/' + n + '.js'] = js('import "./' + (n + 1) + '.js";');
  const first = fixture(files);
  const root = '<script type="module" src="/0.js"></script>';
  const limited = await loadBrowserAssets([document(root)], first.read, timeout());
  assert.deepEqual(first.fetched, Object.keys(files).slice(0, ASSET_IMPORT_DEPTH + 1));
  assert.match(limited.limitations.join(' '), /4-hop.*preview\.example/);
  files[origin + '/' + (ASSET_IMPORT_DEPTH + 1) + '.js'] = js('import "./0.js";');
  const second = fixture(files);
  const short = await loadBrowserAssets([document(root + '<script type="module" src="/4.js"></script>')], second.read, timeout());
  assert.equal(second.fetched.length, Object.keys(files).length);
  assert.deepEqual(short.limitations, []);
});

test('cancellation during expansion retains captured bytes and stops further asset reads', async () => {
  const files = {
    [origin + '/main.js']: js('import "./first.js"; import "./second.js";'),
    [origin + '/first.js']: js('import "./third.js";'),
  };
  const { read, fetched } = fixture(files);
  const stop = new AbortController();
  const capture = await loadBrowserAssets([document('<script type="module" src="/main.js"></script>')], async (url, options) => {
    const response = await read(url, options);
    if (url.pathname === '/first.js') stop.abort();
    return response;
  }, stop.signal);
  assert.deepEqual(fetched, Object.keys(files));
  assert.deepEqual([...capture.assets.keys()], fetched);
  assert.match(capture.limitations.join(' '), /cancellation stopped dependency discovery/);
});

test('discovery observes pending cancellation even when no dependency needs a network read', async () => {
  const stop = new AbortController();
  const page = document('<script type="module">' +
    Array.from({ length: 600 }, (_, i) => 'import("feature-' + i + '");').join('') + '</script>');
  const { read, fetched } = fixture({});
  setImmediate(() => stop.abort());
  const result = await loadBrowserAssets([page], read, stop.signal);
  assert.deepEqual(fetched, []);
  assert.match(result.limitations.join(' '), /cancellation stopped dependency discovery/);
});

test('ineligible and computed imports, external maps, robots denials and MIME mismatches never seed more reads', async () => {
  const tracker = 'js-eu1.hs-scripts.com';
  const files = {
    [origin + '/js/main.js']: js('import "tracker"; import "./x.js?token=PRIVATE"; import "/private/deny.js";' +
      'import "/wrong.js"; import "unknown"; const lazy = (name) => import(name);'),
    [origin + '/wrong.js']: { contentType: 'text/html', body: 'import "/should-not-fetch.js"' },
  };
  const { read, fetched, policies } = fixture(files);
  const captured = await loadBrowserAssets([document(
    '<script type="importmap" src="https://unlisted.example/PRIVATE.json"></script>' +
    '<script type="importmap">{"imports":{"tracker":"https://' + tracker + '/PRIVATE.js?v=1"}}</script>' +
    '<script type="module" src="/js/main.js"></script>')], read, timeout());
  assert.deepEqual(fetched, Object.keys(files));
  assert.deepEqual(policies, [origin]);
  assert.deepEqual([...captured.assets.keys()], [origin + '/js/main.js']);
  const notes = captured.limitations.join(' ');
  for (const term of [tracker, 'unlisted.example', 'preview.example', 'computed import', 'no usable URL', 'external']) assert.ok(notes.includes(term), term);
  assert.doesNotMatch(notes, /PRIVATE|token=|wrong\.js/);
});

test('inline CSS, imported styles and font files share the same allowed origins and crawl policy', async () => {
  const files = {
    [origin + '/css/theme.css']: css('@import url("./more.css"); @font-face{font-family:A;src:url("../fonts/a.woff2?v=1")}'),
    [origin + '/css/more.css']: css('@import "theme.css"; @font-face{font-family:B;src:url("' + cdn + '/fonts/b.ttf")}' +
      '@font-face{font-family:C;src:url("https://other.example/private.woff2")}'),
    [origin + '/fonts/a.woff2?v=1']: { contentType: 'font/woff2', body: '', fontBytes: Buffer.from([0, 255]) },
    [cdn + '/fonts/b.ttf']: { contentType: 'font/ttf', body: '', fontBytes: Buffer.from([1, 2]) },
  };
  const { read, fetched } = fixture(files);
  const result = await loadBrowserAssets([document('<base href="/css/"><style>@import "theme.css";</style>')], read, timeout());
  assert.deepEqual(fetched, Object.keys(files));
  assert.deepEqual(result.assets.get(origin + '/fonts/a.woff2?v=1')?.body, Buffer.from([0, 255]));
  assert.match(result.limitations.join(' '), /other\.example/);
  assert.doesNotMatch(result.limitations.join(' '), /private\.woff/);
});
