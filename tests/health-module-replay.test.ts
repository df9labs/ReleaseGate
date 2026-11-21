import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadBrowserAssets, type BrowserAsset } from '../server/health-assets';
import { discoverBrowserButtons, reviewBrowser } from '../server/health-browser';
import type { PageReader } from '../server/health-pages';
import type { PublicPage } from '../server/health-transport';

const origin = 'https://preview.example', cdn = 'https://cdn.jsdelivr.net';
const timeout = () => AbortSignal.timeout(45_000);
const html = (body: string): PublicPage => ({
  body: '<!doctype html><html lang="en"><title>Module fixture</title>' + body + '</html>',
  url: origin + '/', status: 200, contentType: 'text/html',
});

function recorded(files: Map<string, BrowserAsset>): PageReader {
  return async (url) => {
    if (url.pathname === '/robots.txt') return { url: url.href, status: 404, contentType: 'text/plain', body: '' };
    const asset = files.get(url.href);
    assert.ok(asset, 'Unexpected fixture request ' + url.href);
    return {
      url: url.href, status: 200, contentType: asset.contentType, allowOrigin: asset.allowOrigin,
      body: typeof asset.body === 'string' ? asset.body : '', fontBytes: Buffer.isBuffer(asset.body) ? asset.body : undefined,
    };
  };
}

test('capturing the missing static, dynamic and mapped modules makes cookie and accessibility observations conclusive', async () => {
  const lenis = cdn + '/npm/lenis@1/+esm';
  const page = html('<script type="importmap">{"imports":{"lenis":"' + lenis + '"}}</script>' +
    '<script type="module" src="/js/main.js"></script>' +
    '<main><h1>Station map</h1><button>Cookie settings</button><p hidden>Cookie preferences</p></main>');
  const js = (body: string): BrowserAsset => ({ contentType: 'text/javascript; charset=utf-8', body });
  const files = new Map<string, BrowserAsset>([
    [origin + '/js/main.js', js('import {STATIONS} from "./shapes.js"; const {default: lenis} = await import("lenis");' +
      'document.querySelector("button").onclick = async () => { const {open} = await import("./scene.js"); open(STATIONS, lenis); };')],
    [origin + '/js/shapes.js', js('export {STATIONS} from "./stations.mjs";')],
    [origin + '/js/stations.mjs', js('export const STATIONS = 3;')],
    [origin + '/js/scene.js', js('export function open(stations, lenis) { if (stations === 3 && lenis === "ready") document.querySelector("p").hidden = false; }')],
    [lenis, { ...js('export default "ready"'), allowOrigin: '*' }],
  ]);
  const capture = await loadBrowserAssets([page], recorded(files), timeout());
  assert.equal(capture.assets.size, files.size);
  assert.deepEqual(capture.limitations, []);
  const checks = ['Button: Cookie settings', 'Cookie: Cookie settings', 'Cookie notice or settings', 'Initial JavaScript exceptions',
    'Keyboard focus via Tab', 'Main landmark', 'Text contrast on solid backgrounds'];
  const journey = [{ button: 'Cookie settings', expected_text: 'Cookie preferences' }];

  const missing = new Map(capture.assets);
  missing.delete(origin + '/js/shapes.js');
  const before = await reviewBrowser([page], missing, journey, timeout());
  for (const title of checks) assert.equal(before.checks.find((check) => check.title === title)?.passed, null, title);
  assert.match(before.limitations.join(' '), /blocked requests to preview\.example/);

  const after = await reviewBrowser([page], capture.assets, journey, timeout());
  for (const title of checks) assert.equal(after.checks.find((check) => check.title === title)?.passed, true, title);
  assert.match(after.checks.find((check) => check.title === 'Button: Cookie settings')!.detail, /separate two-second replay without a click/);
  assert.match(after.limitations.join(' '), /loaded third-party assets from cdn\.jsdelivr\.net/);
});

test('a mapped cross-origin module requires captured CORS permission to run', async () => {
  const url = cdn + '/app.mjs';
  const page = html('<script type="importmap">{"imports":{"widget":"' + url + '"}}</script>' +
    '<script type="module">import "widget";</script><main>Cross-origin module</main>');
  const assets = new Map([[url, { contentType: 'text/javascript', body: 'document.body.dataset.ready = "yes"' }]]);
  const report = await reviewBrowser([page], assets, [], timeout());
  assert.equal(report.checks.find((c) => c.title === 'Initial JavaScript exceptions')?.passed, null);
  assert.match(report.limitations.join(' '), /blocked requests to cdn\.jsdelivr\.net/);
});

test('runtime-only blocked hosts appear in the review and picker without request paths or query values', async () => {
  const host = 'js-eu1.hs-scripts.com';
  const page = html('<main><h1>Preferences</h1></main><script>const tag = document.createElement("script");' +
    'tag.src = "https://' + host + '/private-route.js?token=private-value"; document.head.append(tag);</script>');
  const report = await reviewBrowser([page], new Map(), [], timeout());
  const check = report.checks.find((c) => c.title === 'Initial JavaScript exceptions');
  assert.equal(check?.passed, null);
  assert.ok(check.detail.includes(host));
  const picker = await discoverBrowserButtons(page, new Map());
  for (const notes of [report.limitations, picker.limitations]) {
    assert.match(notes.join(' '), /blocked requests to js-eu1\.hs-scripts\.com/);
    assert.doesNotMatch(notes.join(' '), /private-value|private-route|token=/);
  }
  assert.doesNotMatch(check.detail, /private-value|private-route|token=/);
});

test('a blocked import during the no-click observation keeps a named outcome untested', async () => {
  const page = html('<button>Show guide</button><p hidden>Guide opened</p><script type="module">' +
    'const timer = setTimeout(() => import("./missing.js").catch(() => {}), 1200);' +
    'document.querySelector("button").onclick = () => {clearTimeout(timer); document.querySelector("p").hidden = false;};</script>');
  const report = await reviewBrowser([page], new Map(), [{ button: 'Show guide', expected_text: 'Guide opened' }], timeout());
  const check = report.checks.find((c) => c.title === 'Button: Show guide');
  assert.equal(check?.passed, null);
  assert.match(check.detail, /no-click observation/);
  assert.match(report.limitations.join(' '), /blocked requests to preview\.example/);
});

test('Chromium applies nested styles and decodes captured fonts from the page and a trusted CDN', async () => {
  const font = await readFile(new URL('../public/fonts/space-grotesk-latin.woff2', import.meta.url));
  const files = new Map<string, BrowserAsset>([
    [origin + '/css/site.css', { contentType: 'text/css', body: '@import "' + cdn + '/themes/type.css";' }],
    [cdn + '/themes/type.css', { contentType: 'text/css', body:
      '@font-face{font-family:LocalFace;src:url("' + origin + '/local.woff2")}' +
      '@font-face{font-family:CdnFace;src:url("./face.woff2")}.probe{color:rgb(12,34,56)}' }],
    [origin + '/local.woff2', { contentType: 'font/woff2', body: font }],
    [cdn + '/themes/face.woff2', { contentType: 'font/woff2', body: font, allowOrigin: '*' }],
  ]);
  const page = html('<link rel="stylesheet" href="/css/site.css"><main class="probe">Waiting</main>' +
    '<script type="module">const probe = document.querySelector(".probe");' +
    'const faces = await Promise.all(["LocalFace", "CdnFace"].map(f => document.fonts.load("16px " + f)));' +
    'if (faces.every(group => group.length === 1 && group[0].status === "loaded") && getComputedStyle(probe).color === "rgb(12, 34, 56)") probe.textContent = "Both fonts decoded";</script>');
  const capture = await loadBrowserAssets([page], recorded(files), timeout());
  assert.deepEqual(capture.limitations, []);
  let markup = '';
  const report = await reviewBrowser([page], capture.assets, [], timeout(), (_page, rendered) => { markup = rendered; });
  assert.match(markup, /<main class="probe">Both fonts decoded<\/main>/);
  assert.equal(report.checks.find((c) => c.title === 'Initial JavaScript exceptions')?.passed, true);
  assert.match(report.limitations.join(' '), /loaded third-party assets from cdn\.jsdelivr\.net/);
});
