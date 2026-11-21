import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewWebsite, type PageReader } from '../server/health-pages';
import { readReleaseHeaders } from '../server/health-transport';
import { reviewBrowser } from '../server/health-browser';

const start = new URL('https://owned.example/');
const page = (url: URL, body: string, contentType = 'text/html', status = 200) => ({ url: url.href, status, body, contentType });
const timeout = () => AbortSignal.timeout(10_000);

test('navigation, CTA, local and remote fragments, contact links and excluded paths get individual evidence', async () => {
  const reads: string[] = [];
  const read: PageReader = async (u, opts) => {
    const p = u.pathname;
    reads.push(((opts?.statusOnly ?? 'GET') + ' ') + p);
    if (p === '/robots.txt') return page(u, 'User-agent: *\nDisallow: /private\nDisallow: /sitemap.xml', 'text/plain');
    if (p === '/guide') return page(u, '<main><a name="old"></a><h1 id="here">Guide</h1></main>');
    if (p === '/doc.pdf') {
      assert.equal(opts?.statusOnly, 'HEAD');
      assert.equal(opts.allowUrl?.(new URL('/private', start)), false);
      assert.equal(opts.allowUrl?.(new URL('https://unpkg.com/a.pdf')), false);
      return page(u, '', 'application/pdf');
    }
    if (p === '/broken') return page(u, '', 'text/html', 404);
    if (p !== '/') throw new Error('Unexpected read ' + p);
    return page(u, '<base href="/"><nav><a href="/guide#old">Guide</a><a href="/guide#absent">No target</a></nav>' +
      '<main><h1 id="home">Home</h1><a class="primary" href="/broken">Start trial</a><a href="#home">Home</a>' +
      '<a href="#top">Top</a><a href="#missing">Missing</a><a href="/doc.pdf">Spec</a><a href="/private">Private</a>' +
      '<a href="/logout">Exit</a><a href="/secret?token=DO_NOT_STORE">Account</a><a rel="nofollow" href="/other">Other</a>' +
      '<a href="mailto:PRIVATE_EMAIL@example.org">Email</a><a href="tel:5551234">Phone</a></main>');
  };
  const evidence = await reviewWebsite(start, true, read, timeout());
  const check = (title: string) => evidence.checks.find((c) => c.category === 'core_journeys' && c.title === title);
  assert.deepEqual(reads, ['GET /', 'GET /robots.txt', 'GET /guide', 'GET /broken', 'HEAD /doc.pdf']);
  for (const title of ['Navigation to /guide', 'Anchor target #old on /guide', 'Anchor target #home on /', 'Anchor target #top on /',
    'Internal link to /doc.pdf', 'mailto links present', 'tel links present']) assert.equal(check(title)?.passed, true, title);
  for (const title of ['Main CTA to /broken', 'Anchor target #absent on /guide', 'Anchor target #missing on /'])
    assert.equal(check(title)?.passed, false, title);
  for (const title of ['Internal link to /private', 'Internal link to /logout', 'Internal link to /other', 'Internal link to (restricted address)'])
    assert.equal(check(title)?.passed, null, title);
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_EMAIL|5551234|DO_NOT_STORE/);
});

test('initially rendered links and fragment targets use the same bounded public reader', async () => {
  const calls: string[] = [];
  const read: PageReader = async (u, options) => {
    calls.push(((options?.statusOnly ?? 'GET') + ' ') + u.pathname);
    if (u.pathname === '/robots.txt') return page(u, 'User-agent: *\nDisallow: /sitemap.xml', 'text/plain');
    if (options?.statusOnly) return page(u, '', 'text/plain', 204);
    return page(u, '<main><a href="#dynamic">Jump</a><script>document.querySelector("main").insertAdjacentHTML("beforeend", ' +
      JSON.stringify('<p id="dynamic">Here</p><nav><a href="/after-script">Guide</a></nav>') + ')</script></main>');
  };
  const evidence = await reviewWebsite(start, true, read, timeout(), {
    prepareReplay: async (pages) => (observe) => reviewBrowser(pages, new Map(), [], timeout(), observe),
  });
  assert.deepEqual(calls, ['GET /', 'GET /robots.txt', 'HEAD /after-script']);
  assert.equal(evidence.checks.find((c) => c.title === 'Anchor target #dynamic on /')?.passed, true);
  assert.equal(evidence.checks.find((c) => c.title === 'Navigation to /after-script')?.passed, true);
});

test('a disabled crawl and a full link inventory keep omitted destinations untested', async () => {
  const html = Array.from({ length: 42 }, (_, i) => '<a href="/link-' + i + '">Read</a>').join('');
  const calls: string[] = [];
  const evidence = await reviewWebsite(start, false, async (u) => { calls.push(u.href); return page(u, html); }, timeout());
  assert.deepEqual(calls, [start.href]);
  assert.ok(evidence.checks.filter((c) => c.category === 'core_journeys').every((c) => c.passed === null));
  assert.match(evidence.checks.find((c) => c.title === 'Links outside the address sample')?.detail ?? '', /2 reference/);
});

test('fragments on a query-specific page cannot prove the bare path resolves', async () => {
  const evidence = await reviewWebsite(new URL('/store?view=short', start), true, async (u, options) => {
    if (u.search) return { ...page(new URL('/store', start), '<h1 id="here">Store</h1><a href="#here">Here</a><a href="/store">Default</a>'), hadQuery: true };
    if (u.pathname === '/robots.txt') return page(u, 'User-agent: *\nDisallow: /sitemap.xml', 'text/plain');
    assert.equal(options?.statusOnly, 'HEAD');
    return page(u, '', 'text/html', 404);
  }, timeout(), { maxPages: 1 });
  assert.equal(evidence.checks.find((c) => c.title === 'Anchor target #here on /store')?.passed, true);
  assert.equal(evidence.checks.find((c) => c.title === 'Internal link to /store')?.passed, false);
  assert.doesNotMatch(JSON.stringify(evidence), /view=short/);
});

test('a server that declines HEAD can still supply a bounded GET status for a link', async () => {
  const methods: string[] = [];
  const evidence = await reviewWebsite(start, true, async (u, options) => {
    if (u.pathname === '/') return page(u, '<a href="/doc.pdf">PDF</a>');
    if (u.pathname === '/robots.txt') return page(u, 'User-agent: *\nDisallow: /sitemap.xml', 'text/plain');
    assert.equal(u.pathname, '/doc.pdf');
    methods.push(options!.statusOnly!);
    return page(u, '', 'application/pdf', options?.statusOnly === 'HEAD' ? 405 : 200);
  }, timeout());
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.equal(evidence.checks.find((c) => c.title === 'Internal link to /doc.pdf')?.passed, true);
});

test('release evidence reads a published sitemap index, security headers and explicit build metadata', async () => {
  const values: Record<string, string> = { 'strict-transport-security': 'max-age=86400; includeSubDomains', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'self'; report-uri /internal?key=PRIVATE", 'x-build-id': 'rc.45', 'set-cookie': 'PRIVATE=secret' };
  const read: PageReader = async (u, options) => {
    if (u.pathname === '/robots.txt') return page(u, 'User-agent: *\nSitemap: https://external.example/sitemap.xml\nSitemap: https://owned.example/site-index.xml', 'text/plain');
    if (u.pathname === '/site-index.xml') {
      assert.equal(options?.sitemap, true);
      assert.equal(options.allowUrl?.(new URL('https://other.example/site.xml')), false);
      return page(u, '<?xml version="1.0"?><s:sitemapindex xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        '<s:sitemap><s:loc>https://owned.example/one.xml</s:loc></s:sitemap></s:sitemapindex>', 'application/xml');
    }
    assert.equal(u.href, start.href);
    return { ...page(u, '<meta name="app-version" content="2.4.0"><main>Release</main>'), releaseHeaders: readReleaseHeaders((key) => values[key]) };
  };
  const evidence = await reviewWebsite(start, true, read, timeout());
  const check = (title: string) => evidence.checks.find((c) => c.category === 'release_evidence' && c.title === title);
  for (const title of ['Published robots policy', 'Published sitemap', 'HTTPS delivery', 'HTTP Strict Transport Security', 'Response security headers', 'Published build or version metadata'])
    assert.equal(check(title)?.passed, true, title);
  assert.match(check('Published sitemap')?.detail ?? '', /sitemapindex.*1 readable/);
  assert.match(check('Published build or version metadata')?.detail ?? '', /rc\.45.*2\.4\.0/);
  assert.equal(check('Additional advertised sitemaps')?.passed, null);
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE/);
});

test('external, broken, disallowed and malformed sitemaps never earn release evidence', async () => {
  for (const [rules, xml, expected] of [
    ['Sitemap: https://external.example/sitemap.xml', '', null],
    ['User-agent: *\nDisallow: /sitemap.xml', '', null],
    ['Sitemap: https://owned.example/sitemap.xml', '<urlset><url><loc>https://owned.example/', false],
    ['Sitemap: https://owned.example/sitemap.xml', '<urlset><!-- <url><loc>https://owned.example/</loc></url> --></urlset>', false],
    ['Sitemap: https://owned.example/sitemap.xml', '<!DOCTYPE urlset><urlset/>', false],
  ] as const) {
    const evidence = await reviewWebsite(start, true, async (u) => {
      assert.equal(u.origin, start.origin);
      if (u.pathname === '/robots.txt') return page(u, rules, 'text/plain');
      if (u.pathname === '/sitemap.xml') {
        assert.notEqual(expected, null);
        return page(u, xml, 'text/xml');
      }
      return page(u, '<main>Home</main>');
    }, timeout());
    assert.equal(evidence.checks.find((c) => c.title === 'Published sitemap')?.passed, expected);
  }
});
