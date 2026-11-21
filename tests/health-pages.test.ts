import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewWebsite, type PageReader } from '../server/health-pages';
import { HealthReadError } from '../server/health-transport';
import { prepareHealthcheck, completeHealthcheck } from '../server/healthchecks';

const start = new URL('https://website.example/');
const input = prepareHealthcheck({ target_url: start.href, authorization_attested: true });
test('a nofollow response header prevents following even ordinary linked HTML pages', async () => {
  const requests: string[] = [];
  const evidence = await reviewWebsite(start, true, async (url) => {
    requests.push(url.pathname);
    return { ...response(url, '<h1>Page</h1><a href="/details">Details</a>'), robotsTag: 'nofollow' };
  }, AbortSignal.timeout(2000), { maxPages: 12 });
  assert.deepEqual(requests, ['/']);
  assert.ok(evidence.limitations.some(note => note.includes('should not be followed')));
});
function response(url: URL, body: string, status = 200, contentType = 'text/html') {
  return { url: url.origin + url.pathname, body, status, contentType };
}

test('a good HTML response measures page structure without claiming any user journey was exercised', async () => {
  const html = '<html lang="en"><title>Account</title><body><h1>Service unavailable</h1></body></html>';
  const evidence = await reviewWebsite(
    start, false, async (u) => response(u, html), AbortSignal.timeout(1000),
  );
  const run = completeHealthcheck(input, 'HC-1', evidence);
  assert.equal(run.readiness_indicator, 100);
  const counts = Object.fromEntries(run.category_scores.map((c) => [c.id, c.completed_checks]));
  assert.deepEqual(counts, {
    core_journeys: 0, access_data: 0, reliability: 1, usability: 4, release_evidence: 1, html: 1,
  });
  assert.equal(run.checks_performed?.find((c) => c.title === 'Page content delivered')?.category, 'usability');
});

test('a real HTML tree and robots rules determine the observed findings and eligible page sample', async () => {
  const visited: string[] = [];
  const read: PageReader = async (url, options = {}) => {
    visited.push(url.pathname);
    if (url.pathname !== '/') assert.equal(options.origin, start.origin);
    if (url.pathname === '/robots.txt')
      return response(url, 'User-agent: *\nDisallow: /private', 200, 'text/plain');
    if (url.pathname !== '/') return response(url, '', 404);
    return response(
      url,
      `<!doctype html><html lang="en"><title>Welcome</title><body><h1>Home</h1>
      <img alt=""><img src="logo"><script><img src="ignore"></script>
      <a href="/private">Private</a><a href="https://elsewhere.example/home">External</a>
      <a rel="nofollow" href="/not-followed">Ignored</a><a href="/logout">Exit</a><a href="/file.pdf">Download</a>
      <a href="/about">About</a><a href="/about#section">Repeat</a><a href="/book?session=private">Personal link</a></body></html>`,
    );
  };
  const evidence = await reviewWebsite(start, true, read, AbortSignal.timeout(5000));
  const report = completeHealthcheck(input, 'HC-0001', evidence);
  assert.deepEqual(visited, ['/', '/robots.txt', '/about', '/sitemap.xml', '/file.pdf']);
  assert.deepEqual(
    report.inspected_pages?.map((p) => p.status),
    [200, 404],
  );
  assert.deepEqual(
    report.findings.map((f) => f.title),
    ['Image missing alternative text', 'Page returned an unsuccessful HTTP status', 'Internal link to /file.pdf', 'Internal link to /about'],
  );
  assert.match(report.findings[0].evidence_summary, /1 of 2 image/);
  assert.ok(report.checks_performed?.some((c) => c.passed === null));
  assert.ok(report.readiness_indicator < 100);
  assert.equal(report.check_source, 'website');
});

test('a script shell records its source limitations, and unreachable or non-HTML targets cannot be scored healthy', async () => {
  const read: PageReader = async (url) =>
    response(
      url,
      '<html lang="en"><title>App</title><div id="root"></div><script src="/bundle.js"></script></html>',
    );
  const shell = completeHealthcheck(
    input,
    'HC-1',
    await reviewWebsite(start, false, read, AbortSignal.timeout(5000)),
  );
  assert.ok(shell.checks_performed?.some((c) => c.passed === null && c.detail.includes('JavaScript')));
  assert.equal(shell.band, 'not_scored');
  const nonHtml: PageReader = async (u) => response(u, '', 200, 'application/pdf');
  const document = completeHealthcheck(
    input,
    'HC-2',
    await reviewWebsite(start, true, nonHtml, AbortSignal.timeout(5000)),
  );
  assert.equal(document.band, 'not_scored');
  const failed: PageReader = async () => {
    throw new HealthReadError('network', 'Unable to connect.');
  };
  const outage = completeHealthcheck(
    input,
    'HC-3',
    await reviewWebsite(start, true, failed, AbortSignal.timeout(5000)),
  );
  assert.equal(outage.inspected_pages?.[0].status, null);
  assert.equal(outage.readiness_indicator, 0);
  assert.equal(outage.findings.length, 1);
  await assert.rejects(
    reviewWebsite(
      start,
      false,
      async () => {
        throw new HealthReadError('policy', 'Private target.');
      },
      AbortSignal.timeout(5000),
    ),
    /Private target/,
  );
});

test('restricted or unavailable robots instructions stop expansion; an opt-out reads only the submitted page', async () => {
  const calls: string[] = [];
  const read: PageReader = async (url) => {
    calls.push(url.pathname);
    return url.pathname === '/robots.txt'
      ? response(url, '', 503, 'text/plain')
      : response(url, '<p><a href="/next">Next page</a></p>');
  };
  const blocked = await reviewWebsite(start, true, read, AbortSignal.timeout(3000));
  assert.deepEqual(calls, ['/', '/robots.txt']);
  assert.equal(blocked.pages.length, 1);
  calls.length = 0;
  await reviewWebsite(start, false, read, AbortSignal.timeout(3000));
  assert.deepEqual(calls, ['/']);
});

test('three navigation attempts cover aliases exactly once within the page budget', async () => {
  const aliases: string[] = [];
  const read: PageReader = async (u, options) => {
    if (u.pathname === '/')
      return response(u, [1, 2, 3, 4, 5].map((i) => '<a href="/item-' + i + '">Page</a>').join(''));
    if (u.pathname === '/robots.txt') {
      assert.equal(options?.allowUrl?.(new URL('/logout', start)), false);
      return response(u, 'User-agent: *\nDisallow: /restricted', 200, 'text/plain');
    }
    if (options?.sitemap) return response(u, '', 404, 'text/plain');
    if (options?.statusOnly) return response(u, '', 200);
    aliases.push(u.pathname);
    for (const path of ['/restricted', '/checkout', '/guide?session=private', '/asset.pdf'])
      assert.equal(options?.allowUrl?.(new URL(path, start)), false);
    assert.equal(options?.allowUrl?.(new URL('/guide', start)), true);
    return response(new URL('/guide', start), '<title>Guide</title><h1>Guide</h1>');
  };
  const result = await reviewWebsite(start, true, read, AbortSignal.timeout(5000));
  assert.deepEqual(aliases, ['/item-1', '/item-2', '/item-3']);
  assert.equal(result.pages.length, 2);
});

test('only the document title qualifies and delivered images are inspected without body text', async () => {
  for (const [body, issue] of [
    ['<svg><title>Icon</title></svg>', 'Page title missing'],
    ['<img src="release.jpg">', 'Image missing alternative text'],
  ]) {
    const html = '<!doctype html><html lang="en"><head></head><body>' + body + '</body></html>';
    const result = await reviewWebsite(
      start,
      false,
      async (u) => response(u, html),
      AbortSignal.timeout(1000),
    );
    assert.ok(result.checks.some((check) => check.title === issue && check.passed === false));
  }
});

test('sampled HTML diagnostics report concrete defects and pass the original HTML only to the transient observer', async () => {
  const html = '<!doctype html><html lang="en"><head><base href="/guides/"><title>Guide</title>' +
    '<link rel="canonical" href="../guide"><link rel="canonical" href="mailto:bad@example.test">' +
    '<meta name="description" content="Guide"><meta name="robots" content="NOINDEX, follow"></head>' +
    '<body><h1 id="intro" id="again">Guide</h1><h3 id="intro">Overview</h3>' +
    '<a href="/missing"></a><label for="ok">Name</label><input id="ok"><input id="unnamed"></body></html>';
  const captured: string[] = [];
  const visited: string[] = [];
  const result = await reviewWebsite(start, true, async (u) => {
    visited.push(u.pathname);
    if (u.pathname === '/robots.txt') return response(u, '', 404, 'text/plain');
    if (u.pathname === '/missing') return response(u, '<strong>Missing</strong>', 404);
    return { ...response(u, html), robotsTag: 'googlebot: noindex, private-raw-header-value' };
  }, AbortSignal.timeout(5000), {
    environment: 'preview', onHtmlPage: (p) => captured.push(p.body),
  });
  assert.deepEqual(visited, ['/', '/robots.txt', '/missing', '/sitemap.xml']);
  assert.deepEqual(captured, [html]);
  assert.ok(!JSON.stringify(result).includes('private-raw-header-value'));
  assert.deepEqual(new Set(result.checks.filter((c) => c.passed === false).map((c) => c.title)), new Set([
    'Duplicate HTML attributes found', 'Document IDs are reused', 'Heading levels skip a level',
    'Canonical target is invalid or conflicting', 'Links lack a detectable static name',
    'Form controls lack a detectable static name', 'Page returned an unsuccessful HTTP status', 'Internal link to /missing',
  ]));
  assert.ok(result.checks.some((c) => c.category === 'seo' && c.title === 'Search description declared' && c.passed));
  assert.ok(result.limitations.some((n) => n.includes('Indexing directive') && n.includes('preview')));
  assert.ok(result.limitations.some((n) => n.includes('X-Robots-Tag') && n.includes('preview')));
});

test('ordinary labels, image links, relative canonical declarations and omitted optional metadata are handled conservatively', async () => {
  const html = '<html lang="en"><head><title>Guide</title><base href="/section/">' +
    '<link rel="CANONICAL" href="about"><link rel="canonical" href="/section/about"></head>' +
    '<body><h1>Guide</h1><h2>Part one</h2><h4 hidden>Hidden heading</h4>' +
    '<a href="/guide"><img alt="Guide"></a><a href="/info" aria-labelledby="lab"></a>' +
    '<span hidden id="lab">Information</span><a hidden href="/hidden"></a>' +
    '<label>Name <input></label><label for="colour">Colour</label><select id="colour"><option>Blue</option></select>' +
    '<button aria-label="Open"><svg aria-hidden="true"></svg></button><textarea title="Message"></textarea>' +
    '<input type="submit"><input type="hidden"><div inert><button></button></div></body></html>';
  const reviewed = await reviewWebsite(start, false, async (u) => response(u, html), AbortSignal.timeout(2000));
  assert.deepEqual(reviewed.checks.filter((c) => c.passed === false), []);
  assert.ok(reviewed.limitations.some((n) => n.includes('no non-empty meta description')));
  assert.ok(reviewed.checks.some((c) => c.title === 'Canonical target is consistent' && c.passed));
  const noCanonical = await reviewWebsite(start, false, async (u) => response(u, '<h1>Introduction</h1>'),
    AbortSignal.timeout(2000));
  assert.ok(!noCanonical.checks.some((c) => c.title.includes('anonical')));
});

test('repeated search metadata is reported as a sampled opportunity without downloading search destinations', async () => {
  const visited: string[] = [];
  const html = '<html lang="en"><head><title>My guide</title><meta name="description" content="A brief guide">' +
    '<meta name="description" content="Second description"><link rel="canonical" href="https://external.example/">' +
    '<meta name="robots" content="noindex"></head><body><h1>Guide</h1><a href="/second">More</a></body></html>';
  const reviewed = await reviewWebsite(start, true, async (u) => {
    visited.push(u.href);
    if (u.pathname === '/robots.txt') return response(u, '', 404, 'text/plain');
    return response(u, u.pathname === '/' ? html : html.replace('My guide', 'MY   GUIDE'));
  }, AbortSignal.timeout(3000), { environment: 'live' });
  assert.deepEqual(visited, ['/', '/robots.txt', '/second', '/sitemap.xml'].map((path) => new URL(path, start).href));
  assert.ok(reviewed.limitations.some((n) => n.includes('same document title') && n.includes('/second')));
  assert.ok(reviewed.limitations.some((n) => n.includes('multiple meta descriptions')));
  assert.ok(reviewed.limitations.some((n) => n.includes('same meta description')));
  assert.ok(reviewed.limitations.some((n) => n.includes('intended for the live page')));
  assert.deepEqual(reviewed.checks.filter((c) => c.passed === false), []);
});

test('broader sampling visits nested pages breadth-first, honours robots and reports known links still outside the budget', async () => {
  const paths: Record<string, string[]> = {
    '/': ['/a', '/b'], '/a': ['/deep-a', '/blocked', '/b'], '/b': ['/deep-b'],
    '/deep-a': ['/last', '/b', '/'], '/deep-b': ['/last', '/tail'],
  };
  const visits: string[] = [];
  const read: PageReader = async (u, options) => {
    visits.push((options?.statusOnly ? 'HEAD ' : '') + u.pathname);
    if (u.pathname === '/robots.txt') return response(u, 'User-agent: *\nDisallow: /blocked', 200, 'text/plain');
    const anchors = (paths[u.pathname] || []).map((href) => '<a href="' + href + '">Open</a>').join('');
    return response(u, '<html lang="en"><title>Navigation</title><h1>Page links</h1>' + anchors + '</html>');
  };
  const reviewed = await reviewWebsite(start, true, read, AbortSignal.timeout(4000), { maxPages: 5 });
  assert.deepEqual(visits, ['/', '/robots.txt', '/a', '/b', '/deep-a', '/deep-b', '/sitemap.xml', 'HEAD /last', 'HEAD /tail']);
  assert.equal(reviewed.pages.length, 5);
  assert.ok(reviewed.limitations.some((n) => n.includes('2 known eligible internal link(s)') && n.includes('5-page')));
  assert.ok(reviewed.limitations.some((n) => n.includes('1 linked page(s) excluded by robots')));
  visits.length = 0;
  await reviewWebsite(start, true, read, AbortSignal.timeout(4000));
  assert.deepEqual(visits, ['/', '/robots.txt', '/a', '/b', '/sitemap.xml', 'HEAD /deep-a', 'HEAD /deep-b']);
});
