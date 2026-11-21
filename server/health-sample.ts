import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import type { PageReader } from './health-pages';
import { readReleaseHeaders } from './health-transport';

const root = '/healthcheck-sample/';
const guide = root + 'guide';
const scriptPath = root + 'notes.js';
const sitemapPath = root + 'sitemap.xml';
const notesScript = `document.getElementById('show-notes').addEventListener('click', (event) => {
  const notes = document.getElementById('build-notes');
  notes.hidden = !notes.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!notes.hidden));
});`;
const sampleTitle = 'Datum Foundry Nine sample site';
const pages: Record<string, string> = {
  [root]:
    '<!doctype html><html lang="en-GB"><head><title>' +
    sampleTitle +
    '</title><meta name="build-id" content="sample-1"><meta name="description" content="Release notes and a guide to preview checks."><script src="' +
    scriptPath + '" defer></script></head><body><main><h1>Preview release notes</h1><h2>Ideas made real</h2><p>This example includes a missing image description.</p>' +
    '<button id="show-notes" aria-expanded="false" aria-controls="build-notes">Show release notes</button>' +
    '<p id="build-notes" hidden>Preview build approved</p><button type="button">Open status</button>' +
    '<img src="/favicon.svg" width="48" height="48"><p><a href="' +
    guide +
    '">Read the release guide</a></p></main></body></html>',
  [guide]:
    '<!doctype html><html lang="en-GB"><head><title>Release guide</title></head><body><main><h1>Release guide</h1><p>Check the release in preview, record the proof and request approval.</p><p><a href="#">Get started</a></p></main></body></html>',
};
const rules = 'User-agent: ReleaseGateHealthcheck\nAllow: /healthcheck-sample/\nDisallow: /\n';

export function registerSample(app: FastifyInstance) {
  for (const [path, html] of Object.entries(pages))
    app.get(path, (_req, reply) => reply.type('text/html').send(html));
  app.get(root + 'robots.txt', (_req, reply) => reply.type('text/plain').send(rules + 'Sitemap: ' + sampleStart(app.server.address()).origin + sitemapPath + '\n'));
  app.get(sitemapPath, (_req, reply) => {
    const origin = sampleStart(app.server.address()).origin;
    return reply.type('application/xml').send('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      [root, guide].map((path) => '<url><loc>' + new URL(path, origin).href + '</loc></url>').join('') + '</urlset>');
  });
  app.get(scriptPath, (_req, reply) => reply.type('text/javascript').send(notesScript));
}

function sampleStart(address: string | AddressInfo | null) {
  if (!address || typeof address === 'string')
    throw new Error('The sample requires a listening HTTP service.');
  const host =
    address.family === 'IPv6'
      ? '[' + (address.address === '::' ? '::1' : address.address) + ']'
      : address.address === '0.0.0.0'
        ? '127.0.0.1'
        : address.address;
  return new URL(root, 'http://' + host + ':' + address.port);
}

// Only these built-in resources may be read through the loopback exception.
export function sampleReader(address: string | AddressInfo | null): { start: URL; read: PageReader } {
  const start = sampleStart(address);
  const read: PageReader = async (url, options = {}) => {
    const path = url.pathname;
    if (
      url.origin !== start.origin ||
      url.search ||
      url.username ||
      url.password ||
      (!Object.hasOwn(pages, path) && path !== '/robots.txt' && path !== scriptPath && path !== sitemapPath)
    )
      throw new Error('Unknown sample resource.');
    const resource = path === '/robots.txt' ? new URL(root + 'robots.txt', start) : url;
    const res = await fetch(resource, { method: options.statusOnly ?? 'GET', redirect: 'error', signal: options.signal });
    return {
      url: url.href,
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      body: await res.text(),
      ...(options.releaseEvidence ? { releaseHeaders: readReleaseHeaders((name) => res.headers.get(name) ?? undefined) } : {}),
    };
  };
  return { start, read };
}
