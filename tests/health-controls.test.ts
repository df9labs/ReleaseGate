import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewBrowser } from '../server/health-browser';

const run = (body: string, journeys: { button: string; expected_text: string }[] = []) =>
  reviewBrowser([{ url: 'https://owned.example/', status: 200, contentType: 'text/html',
    body: '<!doctype html><html lang="en"><title>Fixture</title><body>' + body + '</body></html>' }],
    new Map(), journeys, AbortSignal.timeout(35_000));

test('tabs, native summaries, galleries, menus and cookie rejection have observable offline outcomes', async () => {
  const report = await run([
    '<main><details><summary>Details</summary><p>Visible detail</p></details>',
    '<button role="tab" aria-selected="false" onclick="this.setAttribute(\'aria-selected\',\'true\')">Product</button>',
    '<button onclick="document.querySelector(\'dialog\').showModal()">Enlarge</button><dialog>Large view</dialog>',
    '<button onclick="document.getElementById(\'next\').focus()">All views</button><a id="next" href="#here">Photo</a>',
    '<button>Compare</button><button aria-expanded="false" onclick="this.setAttribute(\'aria-expanded\',\'true\')">Menu</button>',
    '<div class="carousel"><button onclick="this.nextElementSibling.textContent=\'Second\'">Next</button><p>First</p></div>',
    '<aside id="cookies">We use cookies<button onclick="this.parentElement.hidden=true">Reject all</button><button>Accept all</button></aside>',
    '<button aria-expanded="false" onclick="throw Error()">Delete account</button></main>',
  ].join(''));
  for (const title of ['Tab: Product', 'Disclosure: Details', 'Lightbox: Enlarge', 'Lightbox: All views', 'Menu: Menu', 'Carousel: Next', 'Cookie: Reject all']) {
    const item = report.checks.find((c) => c.title === title);
    assert.equal(item?.passed, true, title + ' ' + item?.detail);
  }
  assert.equal(report.checks.find((c) => c.title === 'Lightbox: Compare')?.passed, null);
  assert.match(report.checks.find((c) => c.title === 'Skipped: Accept all')?.detail ?? '', /rejection/);
  assert.match(report.checks.find((c) => c.title === 'Skipped: Delete account')?.detail ?? '', /transactional/);
});

test('empty native validation, effective field types and labels are measured without submitting', async () => {
  const report = await run([
    '<main><h1>Contact</h1><form onsubmit="throw Error()"><label>Email<input type="email" required></label>',
    '<label for="message">Message</label><textarea id="message"></textarea><input type="unknown">',
    '<button aria-expanded="false">Compare</button><input type="submit" value="Send"></form>',
    '<form novalidate><input aria-label="Terms" aria-required="true"></form></main>',
  ].join(''), [{ button: 'Compare', expected_text: 'Sent' }]);
  const check = (key: string) => report.checks.find((c) => c.title === key);
  assert.equal(check('Empty form constraint validation')?.passed, true, JSON.stringify(report.checks));
  assert.equal(check('Forms without an empty validation observation')?.passed, null);
  assert.equal(check('Form input types')?.passed, false);
  assert.equal(check('Required field declarations')?.passed, false);
  assert.equal(check('Form field labels')?.passed, false);
  assert.equal(check('Skipped: Send')?.passed, null);
  assert.match(check('Button: Compare')?.detail ?? '', /form action/);
});

test('access evidence distinguishes measurable contrast, keyboard focus and visible privacy notices', async () => {
  const report = await run('<main style="background:white;color:black"><h1>Access</h1><a href="/privacy">Privacy policy</a>' +
    '<p style="color:#eee">Very faint</p><p style="background:linear-gradient(red,blue)">Overlay</p><p>We use cookies</p></main>');
  const check = (title: string) => report.checks.find((c) => c.category === 'access_data' && c.title === title);
  for (const title of ['Privacy notice', 'Cookie notice or settings', 'Main landmark', 'Keyboard focus via Tab']) assert.equal(check(title)?.passed, true, title);
  assert.equal(check('Text contrast on solid backgrounds')?.passed, false);
  assert.equal(check('Unmeasured text contrast')?.passed, null);
  const empty = await run('<main style="color:white;background:black">Readable</main>');
  assert.equal(empty.checks.find((c) => c.title === 'Text contrast on solid backgrounds')?.passed, true);
  assert.equal(empty.checks.find((c) => c.title === 'Keyboard focus via Tab')?.passed, null);
  assert.equal(empty.checks.find((c) => c.title === 'Privacy notice')?.passed, null);
});

test('an unrelated timer cannot earn an automatic button pass', async () => {
  const report = await run('<button>Compare</button><p>First</p><script>setTimeout(() => document.querySelector("p").textContent = "Second", 1000)</script>');
  const check = report.checks.find((c) => c.title === 'Lightbox: Compare');
  assert.equal(check?.passed, null);
  assert.match(check?.detail ?? '', /no-click/);
});

test('a control that changes to a transaction on hover is skipped in both kinds of replay', async () => {
  const report = await run('<button onmouseenter="this.textContent=\'Buy now\'" onclick="document.querySelector(\'p\').hidden=false">Compare</button><p hidden>Activated</p>',
    [{ button: 'Compare', expected_text: 'Activated' }]);
  for (const title of ['Button: Compare', 'Lightbox: Compare']) {
    const check = report.checks.find((c) => c.title === title);
    assert.equal(check?.passed, null);
    assert.match(check?.detail ?? '', /transactional|changed before/);
  }
});
