import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { inspectGenericContent, summariseGenericContent, CONTENT_NOTE_PREFIX, type PageContent } from '../server/health-content';
import { contentRules, matchedFeedhiveIds, SKIPPED, FEEDHIVE_PATTERN_IDS } from '../server/health-content-rules';
import { reviewWebsite, type PageReader } from '../server/health-pages';
import { completeHealthcheck, prepareHealthcheck } from '../server/healthchecks';
import { healthcheckDocument } from '../server/health-pdf-document';

type Element = DefaultTreeAdapterTypes.Element;
function elements(markup: string) {
  const out: Element[] = [], pending: DefaultTreeAdapterTypes.Node[] = [parse(markup)];
  while (pending.length) {
    const n = pending.pop()!;
    if ('tagName' in n) { out.push(n); if (['script', 'style', 'template', 'noscript'].includes(n.tagName)) continue; }
    if ('childNodes' in n) for (let i = n.childNodes.length - 1; i >= 0; i--) pending.push(n.childNodes[i]);
  }
  return out;
}
const page = (body: string, path = '/', now = new Date('2026-11-21T12:00:00Z')) =>
  inspectGenericContent(elements('<!doctype html><html><body>' + body + '</body></html>'), path, now);
const ids = (p: PageContent) => p.findings.map((f) => f.id);

test('every FeedHive id is either matched or skipped with a reason, and none is both', () => {
  const matched = new Set(matchedFeedhiveIds()), skipped = Object.values(SKIPPED).flat();
  assert.equal(FEEDHIVE_PATTERN_IDS.length, 120);
  assert.equal(new Set(skipped).size, skipped.length);
  for (const id of skipped) assert.ok(FEEDHIVE_PATTERN_IDS.includes(id) && !matched.has(id), id);
  for (const id of matched) assert.ok(FEEDHIVE_PATTERN_IDS.includes(id), id);
  assert.equal(matched.size + skipped.length, 120);
  assert.ok(contentRules.every((r) => r.re.global));
});

test('placeholder text and template tokens are noted on a single hit', () => {
  for (const text of ['Lorem ipsum dolor sit amet', 'By John Doe', 'Welcome to Your Company', 'Dear [Your Name],', 'Insert logo here',
    'mail example@example.com', '123 Main Street', 'Call (555) 123-4567', 'Hello {{ user.name }}', 'This is [PLACEHOLDER]', 'TODO write this', 'Price: TBD'])
    assert.ok(page('<p>' + text + '</p>').findings.length, text);
  assert.deepEqual(page('<p>Call 020 7946 0000 or visit our Southampton office.</p>').findings, []);
  assert.ok(ids(page('<main><h1>Coming soon</h1></main>')).includes('DF9-TOK'));
  assert.deepEqual(page('<main><h1>Coming soon: new boiler range</h1><p>' + 'Details of the range, installation and servicing. '.repeat(4) + '</p></main>').findings, []);
});

test('form labels called Company Name are not placeholders', () => {
  assert.deepEqual(page('<form><label>Company Name <input></label></form>').findings, []);
  assert.deepEqual(page('<form><label for=c>Company Name</label><input id=c></form>').findings, []);
});

test('one marketing phrase on a body page is not noted, three distinct patterns are', () => {
  assert.deepEqual(page('<p>We take a seamless approach to boiler servicing in Southampton.</p><p>Call us today.</p>').findings, []);
  const result = page('<p>We delve into your heating needs.</p><p>Our seamless service is a testament to our care.</p><p>It is crucial to book early.</p>');
  assert.deepEqual([...new Set(ids(result))].sort(), ['P-03', 'V-01', 'V-03', 'V-04', 'V-09'].filter((i) => ids(result).includes(i)).sort());
  assert.ok(ids(result).includes('V-01') && ids(result).includes('V-09') && ids(result).includes('V-03'));
  const note = summariseGenericContent([result])[0];
  assert.ok(note.startsWith(CONTENT_NOTE_PREFIX) && note.includes('[V-01 Delve and friends]') && note.includes('Better:'));
});

test('two distinct patterns inside one paragraph are noted; the same two in separate paragraphs are not', () => {
  assert.ok(page('<p>Our cutting-edge team will leverage your data.</p>').findings.length >= 2);
  assert.deepEqual(page('<p>Our cutting-edge team is local.</p><p>We leverage your data.</p>').findings, []);
});

test('chatbot residue is noted on a single hit', () => {
  assert.deepEqual(ids(page('<p>As an AI language model, I cannot confirm opening hours.</p>')), ['B-06']);
  assert.deepEqual(page('<p>We answer every phone call.</p>').findings, []);
});

test('tagline cliches in headings are noted even once, including the home-for-your and built-around families', () => {
  for (const h of ['Ideas made real', 'Where design meets engineering', 'Dining, reimagined', 'Unlock the power of your data', 'Look no further',
    'A home for your brand, built around you.', 'Designed around you', 'Tailored to you', 'Empowering teams to ship faster', 'Next-level hosting'])
    assert.ok(page('<h1>' + h + '</h1>').findings.some((f) => f.id === 'DF9-T'), h);
  // The same phrase in ordinary body copy is only one hit, so not noted.
  assert.deepEqual(page('<p>Our service is tailored to you.</p>').findings, []);
});

const taglineLines = ['Not just a website. Your next chapter.', 'A clear path. A better outcome.', 'Build with intention.', 'Your vision. Our craft.',
  'No shortcuts. Just a smarter way to build', 'Small studio. Big possibilities', 'Human creativity × smarter technology'];
test('heading shape families are all noted in headings', () => {
  for (const line of taglineLines)
    assert.ok(page('<h2>' + line + '</h2>').findings.some((f) => f.id === 'DF9-T'), line);
  const hero = page('<main>' + taglineLines.map((l) => '<h1>' + l + '</h1>').join('') + '</main>');
  assert.equal(hero.findings.length, taglineLines.length);
  assert.ok(page('<div class="hero-copy"><p>' + taglineLines[0] + '</p></div>').findings.length === 1);
});
test('plain, specific headings are not noted, and shape families do not run on body paragraphs', () => {
  assert.deepEqual(page('<h1>Boiler repairs in Southampton</h1><h2>Prices from £49.99 a month</h2><h2>Opening hours</h2><h2>Contact the team</h2>').findings, []);
  assert.deepEqual(page('<p>Your vision. Our craft.</p><p>No shortcuts. Just a smarter way to build.</p>').findings, []);
});

test('template testimonials and repeated quotes are noted', () => {
  assert.ok(ids(page('<blockquote>Great service from start to finish, truly happy.<cite>John Doe</cite></blockquote>')).includes('DF9-TEST'));
  assert.deepEqual(page('<blockquote>Great service from start to finish, truly happy.<cite>M. Patel, Romsey</cite></blockquote>').findings, []);
  const quote = '<blockquote>The team rebuilt our booking system in a fortnight and it has not failed since.</blockquote>';
  const notes = summariseGenericContent([page(quote, '/'), page(quote, '/about'), page('<p>Other.</p>', '/x')]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /on 2 of 3 pages/);
});

test('dead calls to action are noted unless a handler is visible', () => {
  assert.ok(ids(page('<a href="#">Get started</a>')).includes('DF9-CTA'));
  assert.ok(ids(page('<a href="javascript:void(0)">Book now</a>')).includes('DF9-CTA'));
  for (const html of ['<a href="#" onclick="go()">Book now</a>', '<a href="#faq">FAQ</a>', '<a href="#" data-bs-toggle="modal">Book now</a>',
    '<a href="#">Back to top</a>', '<a href="/book">Book now</a>', '<a href="#" id="buy">Buy</a>'])
    assert.deepEqual(page(html).findings, [], html);
});

test('a copyright year more than one year old is noted with low-severity wording', () => {
  const stale = page('<footer>© 2022 Example Ltd</footer>');
  assert.deepEqual(ids(stale), ['DF9-YR']);
  assert.match(summariseGenericContent([stale])[0], /low severity/);
  assert.deepEqual(page('<footer>© 2025 Example Ltd</footer>').findings, []);
  assert.deepEqual(page('<footer>© 2026 Example Ltd</footer>').findings, []);
});

test('script, style, template, noscript and hidden text are ignored', () => {
  assert.deepEqual(page('<script>var a = "Lorem ipsum";</script><style>.a::after{content:"TODO"}</style><template>{{x}}</template><noscript>TBD</noscript><p hidden>John Doe</p>').findings, []);
});

test('findings are aggregated across pages with a page count and trimmed text', () => {
  const p = (path: string) => page('<p>Hello {{ first_name }}</p>', path);
  const notes = summariseGenericContent([p('/'), p('/a'), p('/b'), p('/c'), page('<p>Fine.</p>', '/d'), page('<p>Fine.</p>', '/e')]);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /on 4 of 6 pages/);
  const long = summariseGenericContent([page('<p>Not just a ' + 'very '.repeat(30) + 'long thing, it is a lot. Moreover, we delve into it. Look no further than us.</p>')]);
  assert.ok(long.every((n) => (/"([^"]*)"/.exec(n)?.[1].length ?? 0) <= 80));
});

// Integration: notes arrive in limitations, and nothing about the checks changes.
const start = new URL('https://website.example/');
const html = (body: string) => '<html lang="en"><head><title>T</title><meta name="description" content="d"></head><body>' + body + '</body></html>';
async function review(bodies: Record<string, string>) {
  const read: PageReader = async (url) => {
    if (url.pathname === '/robots.txt') return { url: url.href, status: 200, contentType: 'text/plain', body: 'User-agent: *\nAllow: /\n' };
    const body = bodies[url.pathname];
    if (body === undefined) return { url: url.href, status: 404, contentType: 'text/html', body: '' };
    return { url: url.origin + url.pathname, status: 200, contentType: 'text/html', body: html(body) };
  };
  return reviewWebsite(start, true, read, AbortSignal.timeout(5000), { maxPages: 4 });
}
test('generic content notes never change the check results', async () => {
  const plain = await review({ '/': '<h1>Boiler repairs</h1><p>Call us.</p>' });
  const slop = await review({ '/': '<h1>Ideas made real</h1><p>Call us.</p><footer>© 2019 Acme</footer>' });
  assert.deepEqual(plain.limitations.filter((n) => n.startsWith(CONTENT_NOTE_PREFIX)), []);
  const notes = slop.limitations.filter((n) => n.startsWith(CONTENT_NOTE_PREFIX));
  assert.equal(notes.length, 2);
  assert.deepEqual(slop.checks.map((c) => [c.title, c.passed]).sort(), plain.checks.map((c) => [c.title, c.passed]).sort());
});

test('the PDF lists the notes in their own section and says they are not a pass or a fail', async () => {
  const evidence = await review({ '/': '<h1>Ideas made real</h1><p>Call us.</p>' });
  const run = completeHealthcheck(prepareHealthcheck({ target_url: start.href, authorization_attested: true }), 'HC-1', evidence);
  const doc = healthcheckDocument(run);
  assert.match(doc, /<h2>Generic AI content<\/h2>/);
  assert.match(doc, /Nothing here counts as a pass or a fail/);
  assert.match(doc, /Ideas made real/);
  const limitsSection = /<h2>Scope and limitations<\/h2>([\s\S]*?)<\/section>/.exec(doc)?.[1] ?? '';
  assert.ok(!limitsSection.includes('Ideas made real'));
});
