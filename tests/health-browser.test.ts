import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { reviewBrowser, type BrowserAsset } from '../server/health-browser';
import type { PublicPage } from '../server/health-transport';

const start = 'https://preview.example/';
const sample = (body: string, url = start): PublicPage => ({
  body: '<!doctype html><html lang="en"><title>Review fixture</title><body>' + body + '</body></html>',
  url,
  contentType: 'text/html',
  status: 200,
});
const signal = () => AbortSignal.timeout(30_000);

test('captured Google Fonts CSS and binary font replay with the observed CORS header', async () => {
  const css = 'https://fonts.googleapis.com/css2?family=Fixture', font = 'https://fonts.gstatic.com/s/fixture/v1/latin.woff2';
  const assets = new Map<string, BrowserAsset>([
    [css, { contentType: 'text/css', body: '@font-face{font-family:Fixture;src:url("' + font + '")}body{font-family:Fixture}' }],
    [font, { contentType: 'font/woff2', body: await readFile(new URL('../public/fonts/space-grotesk-latin.woff2', import.meta.url)), allowOrigin: '*' }],
  ]);
  const report = await reviewBrowser([sample('<link rel="stylesheet" href="' + css + '"><p>Actual font bytes</p>' +
    '<script>document.fonts.ready.then(() => {if (!document.fonts.check("12px Fixture")) throw Error()})</script>')], assets, [], signal());
  assert.equal(report.checks.find((c) => c.title === 'Initial JavaScript exceptions')?.passed, true);
  assert.match(report.limitations.join(' '), /fonts\.googleapis\.com, fonts\.gstatic\.com/);
});

test('cached CDN scripts execute offline and only hosts actually loaded appear in the report', async () => {
  const cdn = 'https://cdn.jsdelivr.net/ui.js', unused = 'https://unpkg.com/unused.js';
  const script = { body: 'document.querySelector("button").onclick = () => document.querySelector("output").hidden = false',
    contentType: 'text/javascript', allowOrigin: '*' };
  const html = '<button>Cookie settings</button><output hidden>Preferences</output><script crossorigin src="' + cdn + '"></script>';
  const assets = new Map([[cdn, script], [unused, script], ['https://unlisted.example/ui.js', script]]);
  const report = await reviewBrowser([sample(html)], assets, [{ button: 'Cookie settings', expected_text: 'Preferences' }], signal());
  assert.equal(report.checks.find((c) => c.title === 'Initial JavaScript exceptions')?.passed, true);
  assert.equal(report.checks.find((c) => c.title === 'Button: Cookie settings')?.passed, true);
  assert.match(report.limitations.join(' '), /loaded third-party assets from cdn\.jsdelivr\.net/);
  assert.doesNotMatch(report.limitations.join(' '), /unpkg/);
  const blocked = await reviewBrowser([sample(html + '<script src="https://unlisted.example/ui.js"></script>')], assets, [], signal());
  assert.equal(blocked.checks.find((c) => c.title === 'Initial JavaScript exceptions')?.passed, null);
});

test('Chromium clicks named buttons and declared disclosures, and records untouched or inconclusive cases', async () => {
  const page = sample(`
    <h1>Release preview</h1>
    <button aria-expanded="false" aria-controls="panel" id="open">Show panel</button>
    <section id="panel" hidden>Panel visible</section>
    <button>Does nothing</button>
    <button disabled>Disabled</button>
    <button>Other</button><button>Other</button>
    <script src="/controls.js"></script>`);
  const assets = new Map<string, BrowserAsset>([
    [
      start + 'controls.js',
      {
        contentType: 'text/javascript',
        body: `document.getElementById('open').onclick = function () {
      document.getElementById('panel').hidden = false;
      this.setAttribute('aria-expanded', 'true');
    };`,
      },
    ],
  ]);
  const report = await reviewBrowser(
    [page],
    assets,
    [
      { button: 'Show panel', expected_text: 'Panel visible' },
      { button: 'Does nothing', expected_text: 'Finished' },
      { button: 'Does nothing', expected_text: 'Release preview' },
      { button: 'Disabled', expected_text: 'Enabled' },
      { button: 'Other', expected_text: 'Done' },
      { button: 'Absent', expected_text: 'Done' },
    ],
    signal(),
  );
  const cases = report.checks.filter((c) => c.title.startsWith('Button:'));
  assert.deepEqual(
    cases.map((c) => c.passed),
    [true, false, null, null, null, null],
  );
  assert.match(cases[2].detail, /already visible/);
  assert.match(cases[4].detail, /Found 2/);
  assert.match(cases[5].detail, /Found 0/);
  assert.equal(report.checks.find((c) => c.title === 'Disclosure: Show panel')?.passed, true);
  assert.equal(report.checks.find((c) => c.title === 'Buttons without a verified outcome')?.passed, null);
});

test('browser isolation blocks HTTP, socket and form traffic and distinguishes incomplete evidence', async (t) => {
  let requests = 0;
  const trap = createServer((_req, res) => {
    requests++;
    res.end('unexpected request');
  });
  trap.on('upgrade', (_req, socket) => {
    requests++;
    socket.destroy();
  });
  trap.listen(0, '127.0.0.1');
  await once(trap, 'listening');
  t.after(() => new Promise<void>((resolve) => trap.close(() => resolve())));
  const origin = 'http://127.0.0.1:' + (trap.address() as AddressInfo).port;
  const page = sample(
    `<h1>Test</h1><form action="/write" method="post"><button>Submit</button></form>
    <button id="save">Save</button><output hidden>Saved</output>
    <script>
      document.getElementById('save').onclick = () => {
        fetch('/write', { method: 'POST', body: 'data' }).catch(() => {});
        navigator.sendBeacon('/beacon','data');
        const ws = new WebSocket('ws://' + location.host + '/socket'); ws.onerror = () => {};
        document.querySelector('output').hidden = false;
      };
    </script>`,
    origin + '/',
  );
  const report = await reviewBrowser(
    [page],
    new Map(),
    [
      { button: 'Save', expected_text: 'Saved' },
      { button: 'Submit', expected_text: 'Submitted' },
    ],
    signal(),
  );
  assert.deepEqual(
    report.checks.filter((c) => c.title.startsWith('Button:')).map((c) => c.passed),
    [null, null],
  );
  assert.equal(requests, 0);
});

test('missing dependencies and captured site policy keep blocked button outcomes unverified', async () => {
  const withMissingScript = sample('<h1>App</h1><script src="/app.js"></script>');
  const missing = await reviewBrowser(
    [withMissingScript],
    new Map(),
    [{ button: 'Send', expected_text: 'Sent' }],
    signal(),
  );
  assert.equal(missing.checks.find((c) => c.title === 'Button: Send')?.passed, null);
  assert.equal(missing.checks.find((c) => c.title === 'Initial JavaScript exceptions')?.passed, null);
  const restricted = {
    ...sample('<button onclick="document.querySelector(\'p\').hidden=false">Open</button><p hidden>Done</p>'),
    contentSecurityPolicy: "script-src 'none'",
  };
  const blocked = await reviewBrowser(
    [restricted],
    new Map(),
    [{ button: 'Open', expected_text: 'Done' }],
    signal(),
  );
  assert.equal(blocked.checks.find((c) => c.title === 'Button: Open')?.passed, null);
  const empty = await reviewBrowser([], new Map(), [{ button: 'Open', expected_text: 'Done' }], signal());
  assert.equal(empty.checks.find((c) => c.title === 'Button: Open')?.passed, null);
});

test('an inert declaration and an actual JavaScript exception produce failed browser observations', async () => {
  const page = sample(
    '<button aria-expanded="false" aria-controls="p">Open panel</button>' +
      '<p hidden id="p">Panel</p><script>throw new TypeError("fixture");</script>',
  );
  const report = await reviewBrowser([page], new Map(), [], signal());
  assert.equal(report.checks.find((c) => c.title === 'Disclosure: Open panel')?.passed, false);
  const fault = report.checks.find((c) => c.title === 'Initial JavaScript exceptions');
  assert.equal(fault?.passed, false);
  assert.match(fault?.detail ?? '', /TypeError/);
});

test('a timer can reveal the expected text without exercising the button', async () => {
  const page = sample(
    '<button>Reveal</button><p hidden>Ready</p>' +
      '<script>setTimeout(() => { document.querySelector("p").hidden = false }, 800)</script>',
  );
  const report = await reviewBrowser(
    [page],
    new Map(),
    [{ button: 'Reveal', expected_text: 'Ready' }],
    signal(),
  );
  const check = report.checks.find((c) => c.title === 'Button: Reveal');
  assert.equal(check?.passed, null);
  assert.match(check?.detail ?? '', /without a click/);
});

test('a cancelled review accounts for each requested page and named journey', async () => {
  const pages = [sample('<p>A</p>'), sample('<p>B</p>', start + 'help')];
  const report = await reviewBrowser(
    pages,
    new Map(),
    [{ button: 'Open', expected_text: 'Ready' }],
    AbortSignal.abort(),
  );
  assert.deepEqual(
    report.checks.filter((c) => c.title === 'Browser checks unfinished for this page').map((c) => c.page),
    pages.map((page) => page.url),
  );
  assert.ok(report.checks.every((c) => c.passed === null));
  assert.ok(report.checks.some((c) => c.title === 'Button: Open'));
});
