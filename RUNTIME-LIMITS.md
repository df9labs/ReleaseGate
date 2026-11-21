# Website healthcheck runtime limits

The website reader allows 10 seconds per read and 1 MiB each of transferred and decoded content. HTML and asset capture share 75 seconds (`REVIEW_MS` in `server/health-crawl.ts`). Each asset request is a credential-free GET to the exact approved URL. The transport validates public IP addresses, pins the connection and excludes redirects that change the asset URL. Capture reads robots.txt once per asset origin and waits at least 250 ms before each asset GET, or the published crawl delay if longer.

Browser capture allows **80 asset reads across all sampled pages** (raised from 40 on 2026-11-20 for module-heavy sites) (`ASSET_LIMIT` in `server/health-assets.ts`). Scripts, stylesheets and fonts draw from the same allowance. Failed reads and responses with an unsuitable MIME type consume a read. Robots requests share the time limit and use a separate per-origin cache. Asset bytes stay in memory and each URL is fetched at most once per run.

Capture starts with the scripts, stylesheets, module preloads and font preloads declared in HTML. Inline scripts and styles also start at depth zero. Capture follows dependencies breadth-first for **four import hops** (`ASSET_IMPORT_DEPTH`). This gives directly declared assets and shallow imports priority when the read budget runs out. Cycles reuse captured bytes. A shared module can resolve different children on different pages.

JavaScript parsing finds static imports, re-exports and literal dynamic imports. Relative paths resolve against the importing module. Each page’s inline import maps supply exact names, slash-prefix mappings and scopes, using the document base for relative targets. Computed expressions, unmapped bare names and external import maps can leave dependencies unavailable. CSS imports resolve against the importing stylesheet, as do font URLs in `@font-face` source lists.

The third-party allowlist is `trustedAssetHosts` in `server/health-transport.ts`. It requires HTTPS on the standard port and matches these hostnames exactly.

- cdn.jsdelivr.net
- unpkg.com
- cdnjs.cloudflare.com
- fonts.googleapis.com
- fonts.gstatic.com
- ajax.googleapis.com
- code.jquery.com

`server/health-assets.ts` admits referenced JS, MJS, CSS, WOFF, WOFF2, TTF and OTF on the page origin or these seven HTTPS hosts. Simple version parameters allow up to 64 characters per value. The jsDelivr npm and unpkg package entry points may supply scripts with a JavaScript MIME type. Google Fonts stylesheet endpoints also accept family, display and subset values of up to 64 characters. Font files on fonts.gstatic.com must be under `/s/` with a query-free URL.

`server/health-browser.ts` replays the original HTML and inline maps in fresh, signed-out, sandboxed Chromium contexts. Only captured scripts, styles and fonts with matching MIME types can load. Chromium enforces the page’s captured content security policy and the captured cross-origin permissions. Replay has its own 75-second budget, including an 8-second launch allowance, 5 seconds per page load, 250 ms for settling and 2 seconds per action. The report names third-party hosts actually loaded and hosts whose requests were blocked. Host diagnostics omit paths and queries. An unavailable dependency that interrupts an observation leaves the affected check untested.

## Automatic interactions and access checks

The inventory covers the first 100 visible buttons, tabs and summaries per page. A run can exercise eight automatic controls and eight named checks. Each automatic pass includes a separate two-second no-click observation. Cookie controls use the control name and up to 500 characters of nearby banner text. Consent rejection takes priority over acceptance. Report labels use up to 80 characters and grouped untested controls include up to five examples. The control classifier is in `server/health-controls.ts`.

`server/health-browser-access.ts` samples the first 100 non-empty body text runs per page for contrast. It measures solid, visible colour pairs in the desktop viewport, using ratios of 4.5:1 for normal text and 3:1 for large text. Complex backgrounds and additional text are untested. Keyboard evidence covers one Tab press per page. Form checks observe native invalid events on initially empty required fields through constraint validation.

## Navigation and release evidence

`server/health-pages.ts` samples four HTML pages by default and accepts a page limit from 1 to 25. `server/health-links.ts` reports up to 40 distinct navigation, CTA or link destinations per page, including fragment variations. Path labels show up to 160 characters and simple fragment labels up to 80 characters. Additional references get an untested count. The starting rendered document for each sampled page has the same 1 MiB inspection limit as delivered HTML.

Link checks reuse sampled responses. With link following enabled, a run can make up to 40 additional same-origin, status-only requests across all pages. HEAD is tried first. A 405 or 501 permits one body-free GET within the same allowance. Crawl delays, path restrictions, robots rules, the shared capture deadline and redirect validation apply. Fragment targets require inspected HTML. Mail and telephone handlers are never opened. Disabling link following keeps remote destinations, robots and sitemap reads for link inspection outside the review.

`server/health-release.ts` inspects one permitted sitemap per run. It considers addresses advertised in robots.txt and uses /sitemap.xml when none are advertised. The reader parses up to 1 MiB of XML in memory. It counts HTTP(S) locations in a sitemap or sitemap index and does not expand child sitemaps. The report records HTTPS, positive HSTS max-age, named security headers and recognised public build or version declarations. Reportable build values allow up to 80 characters. Cookie and credential headers are excluded.

Robots files: a 4xx robots.txt response other than 429 is treated as "no restrictions" (RFC 9309, section 2.3.1.3). A 429 or 5xx response still blocks capture from that host. See `server/health-crawl.ts`.
