import test from 'node:test';
import assert from 'node:assert/strict';
import { readCrawlPolicy } from '../server/health-crawl';

const origin = 'https://cdn.example.test';
const reader = (status: number) => (async (url: URL) =>
  ({ url: url.href, status, contentType: 'text/plain', body: 'Bad Request' })) as never;

test('a 4xx robots.txt other than 429 is treated as unrestricted (RFC 9309)', async () => {
  for (const status of [400, 403, 404, 410]) {
    const policy = await readCrawlPolicy(origin, reader(status), AbortSignal.timeout(1000));
    assert.equal(policy.limitation, '', 'status ' + status);
    assert.equal(policy.allowed(new URL(origin + '/npm/x.js')), true);
  }
});

test('429 and 5xx robots.txt responses still block capture', async () => {
  for (const status of [429, 500, 503]) {
    const policy = await readCrawlPolicy(origin, reader(status), AbortSignal.timeout(1000));
    assert.notEqual(policy.limitation, '', 'status ' + status);
  }
});
