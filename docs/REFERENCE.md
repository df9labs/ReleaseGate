# ReleaseGate reference guide

ReleaseGate is Datum Foundry Nine’s local release control room. Follow a report from intake to a preview repair, compare the failing and passing checks, record the human decision where required, then link the evidence to a version. The default installation runs on one machine with SQLite and serves its own fonts, icons, JavaScript and CSS.

## Run on Windows

With Node.js 24.14 or later and npm installed, open PowerShell in this folder and run this command.

```powershell
.\run.cmd
```

Open **http://127.0.0.1:4310**. Sign in as **admin@releasegate.local** with the value of **DEMO_ADMIN_PASSWORD** in the private `.env` file created on first launch. The password is generated per installation. The first launch downloads the locked dependencies, builds the client and server, applies the migrations and seeds the database. Subsequent starts retain your records. Press Ctrl+C in the server terminal to stop it. On Linux the equivalent launcher is `node scripts/start-local.mjs`.

For client development, start the application and run `npm run dev` in a second terminal. Vite forwards API requests to the configured local port. For server development, stop the normal launcher and use `npm run dev:api` with the same local environment.

The first launch seeds a small demo workspace: one report waiting for a human decision, an empty version history and a set of saved healthchecks.

## Run a Healthcheck

1. Sign in as the administrator and open **Healthcheck → New healthcheck**.
2. Enter a public website URL you are authorised to review, or choose **Try a sample site → Add sample button checks**. The two-page sample includes a working release-notes button, a deliberately inert status button and an image missing alternative text.
3. Choose the page limit and confirm authorisation. Leave **Run browser checks** selected to exercise the rendered pages. Select **Find buttons** to list the buttons visible to a signed-out visitor on the starting page. Choose **Add check** beside a button and enter the new text you expect after a click. You can also type a button name. Select **Run healthcheck**. No API key is required.
4. Select a failed finding to see its evidence. Use its bug action to create a traceable report. The saved run remains available in the Healthcheck selector.

To download a report, choose the run in **Healthcheck history** and select **Export PDF**. The PDF uses the saved results, including findings, individual observations and recorded limitations. Exporting does not revisit the site.

### Check a Windows desktop application

1. Open the installed application, for example Indie Dev Studio, and bring its main window to the screen you want to check. Use the same signed-in Windows desktop as the local ReleaseGate server.
2. In **New healthcheck**, choose **Windows desktop app (.exe)**, confirm authorisation and select **Choose .exe on this PC**. In the Windows file picker, choose the executable that owns the open window. If the application has a launcher, this may be a different file from the launcher or installer.
3. The inspector lists the visible buttons Windows exposes. For an inventory alone, select **Finish inspection**. To test a button, select it, enter the exact name of an element you expect to appear in the same window and confirm **Check selected button**. An approved action operates the running app, so choose a test project for actions that change your work.
4. Back in ReleaseGate, select **Run healthcheck** to save the inspection. **Export PDF** includes the inventory, individual outcomes and limitations. A rerun opens the form for a fresh inspection.

Finding a button records no passing check. A pass means the specified element appeared in the inspected window after the action. A separate window, a file written to disk or a remote save needs its own evidence. Custom-drawn controls can be invisible to Windows accessibility tools. No API key or executable upload is required. [Microsoft’s overview of Windows UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview)

To repeat a check, select the result in **Healthcheck history** and click **Rerun healthcheck**. For a saved local website or sample, this authorises a fresh read-only run with its saved target, build, page scope and button checks. The new result gets its own history entry. Choose **Edit and rerun** to change settings or add fresh staging results. Evidence-only and imported historical reviews open with their settings filled in. Enter fresh evidence for an evidence-only review. If the report records that the original URL included a query or fragment, re-enter the address. Older reports that predate this record can repeat only their saved address.

Open **Browser function checks** to inspect passes, failures and untested outcomes. Sandboxed Chromium opens a fresh signed-out copy for each action. It exercises safe disclosures, tabs, menus, galleries and cookie controls, preferring rejection. Each pass needs an observed change and a separate no-click observation. Access & data includes native form validation, field labels, keyboard focus, landmarks, visible privacy notices and text contrast where the rendered colours can be measured.

Read the page count and failed or inconclusive observations alongside the total. HTML checks examine title, language, headings, image alternatives, IDs, duplicate attributes and detectable link and form-control names. Technical SEO checks examine titles, descriptions, canonicals and indexing directives across the sampled pages. Missing optional metadata and repeated descriptions appear as review notes. Actual search indexing and rankings require independent evidence. [Google Search Central on metadata](https://developers.google.com/search/docs/crawling-indexing/special-tags)

For sign-in and saved-data journeys, run the site's own Playwright suite against its staging build with the JSON reporter and select the resulting file in **Playwright JSON report**. Set the target and build to identify the run. ReleaseGate imports the case names and outcomes and identifies their source on each result. Skipped, flaky, interrupted and expected-to-fail cases supply no positive evidence. You can also enter operator observations on separate `PASS:` or `FAIL:` lines. Either type of evidence can be reviewed without a website URL. [Playwright JSON reporter](https://playwright.dev/docs/test-reporters#json-reporter)

## Try the repair loop

1. Select **Inject a report**. Use the title **Client card does not expand** and affected area **Dashboard**. Describe the card staying closed, the expected open state and the steps to reproduce it. Record the observation under evidence.
2. Choose **Log bug and check**, then **Open bug record**. In the default demo the analysis identifies a broken disclosure control. **Plan Preview repair** saves the plan, intended checks and checkpoint.
3. **Record implementation** applies the correction to an isolated fixture. **Record Preview retest** exercises the broken and corrected fixtures. Inspect the saved before/after results in the record.
4. **Review release gate**, give a reason and approve or reject. For an approved repair, go to **Versions**, record a version with passing QA and Preview evidence, and select the linked bug.
5. Expand the new version, choose **Mark released**, then record the separately observed Live result. A release entry records an operator decision. An operator-supplied live result and a fixture test receipt have different evidence sources.

For a repeatable inbound report, open a second terminal in the project and run `npm run demo:inject`. It prints the new bug reference and a local link. Set `DF9_DEMO_REQUEST_ID` to reuse the same intake request on retry. With the local admin session it also requests analysis. With a sender key the server automatically requests the first analysis on intake. An admin can reanalyse from the bug record. The sender accepts loopback URLs only. [Sender code](../scripts/inject-demo.mjs) · [Engine, fixtures and safety rules](docs/REPAIR_ENGINE.md)

## Configuration and integrations

Copy the relevant settings from `.env.example` into the ignored `.env` and restart. The browser’s **Settings** page controls the target product, preview/live reference URLs, report prefix and automation policy. Those settings persist in SQLite. Changing the bootstrap password in the environment affects fresh installations. Existing accounts use password recovery.

| Setting | Purpose |
|---|---|
| `HOST`, `PORT`, `DATA_DIR` | Defaults are `127.0.0.1`, `4310` and `./data`. The database is `releasegate.sqlite`. |
| `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` | Bootstrap the first admin. New self-registered accounts have the ordinary user role. Passwords use salted scrypt hashes. Sessions use HTTP-only, SameSite=Strict cookies, marked Secure in production. |
| `PUBLIC_ORIGIN` | Exact public HTTPS origin for cross-origin write checks behind a reverse proxy. |
| `DF9_INTAKE_KEYS` | JSON object mapping sender names to private keys. `DF9_INTAKE_KEY` configures a single default sender. |
| `RELEASEGATE_BASE_URL`, `DF9_DEMO_REQUEST_ID` | Destination and optional stable request ID for the bundled local sender. |
| `LLM_API_KEY`, `LLM_ENDPOINT`, `LLM_MODEL`, `LLM_TIMEOUT_MS` | Optional server-side, proposal-only analyser. The endpoint accepts an OpenAI-compatible API base URL or a full chat completions URL. The defaults are the OpenAI chat completions endpoint and `gpt-5-mini`. Only configure a provider that may receive the selected report fields. Without a key the deterministic engine works offline. |

Other apps can `POST /api/reports` with `Authorization: Bearer <sender key>`, `Content-Type: application/json` and an `Idempotency-Key` unique to that sender and report. The minimum JSON body has `title`, `description` and `affected_module`. Optional fields include `environment`, `severity`, `actual_behavior`, `expected_behavior`, `reproduction_steps` and `evidence`. The result includes `bug.id` and `bug.bug_number`. Replaying the same request returns its original record. Sender credentials grant intake access only. The original browser trace established no portal or Start Here connection. [REST map](docs/API_MAP.md) · [Connection evidence](docs/CONNECTIONS.md)

Local password recovery writes a single-use link to the private `DATA_DIR/outbox` directory. Production recovery requires a delivery adapter. The local login uses email/password. The provider-branded sign-in affordance explains the local method. External Live verification records a separate operator decision.

## Docker on Ubuntu

For a split deployment (static site on Netlify, API on an Ubuntu host), see [deploy/ubuntu/README.md](../deploy/ubuntu/README.md). With this checkout's locked npm dependencies installed, run `python scripts/package-netlify.py`. It writes a public site-only archive and a private deployment kit to `output/deploy` and leaves the local Windows build in place. The kit uses **releasegate-api.df9labs.com** as the proposed Ubuntu API hostname. Its fresh database starts with empty registers. The Windows inspector remains available in the local installation.

Build from this directory. Prepare a private host environment file containing the chosen `DEMO_ADMIN_EMAIL`, a strong `DEMO_ADMIN_PASSWORD` and the exact `PUBLIC_ORIGIN`. The example assumes an HTTPS reverse proxy on the same host.

```sh
docker build -t df9-releasegate .
docker volume create releasegate-data
docker run -d --name releasegate --restart unless-stopped \
  --env-file .env -e NODE_ENV=production -e HOST=0.0.0.0 -e PORT=4310 -e DATA_DIR=/app/data \
  -p 127.0.0.1:4310:4310 -v releasegate-data:/app/data df9-releasegate
```

Forward the public HTTPS origin to `127.0.0.1:4310`. The container runs as the `node` user. The image installs Chromium. Browser checks require a container runtime that supports its process sandbox. If Chromium cannot start, the report records browser checks as inconclusive. Verify those checks with the built-in sample on the destination host. The volume holds the database across image replacements. To back up a running service, use SQLite’s online backup facility or stop it and back up the entire data directory. Docker was unavailable for an image build on this Windows machine. [Playwright’s container and sandbox guidance](https://playwright.dev/docs/docker)

## Limits and where to change them

| Area | Limit or policy | Location |
|---|---|---|
| HTTP and text | 128 KiB request body. Text fields and each text-list entry default to 16,000 characters. Report and version titles allow 240, version identifiers 128. | `server/app.ts`, `server/support.ts`, `server/rules.ts`, `server/releases.ts`, `src/views/Report.tsx` |
| Identity | Email 254 characters, display name 120, passwords 8–128. Sessions last 7 days. Recovery tokens last 30 minutes and the submitted token limit is 128 characters. Login, registration and recovery each allow 30 attempts per source IP and route per 15 minutes. | `server/auth.ts` |
| Intake | Sender keys have at least 16 characters. Integrations require an idempotency key. All idempotency keys allow 1–160 characters. | `server/app.ts` |
| Lists | The bug endpoint defaults to 300 records, accepts 1–500 and uses a non-negative offset. Search returns up to 500. Notifications show the 20 most recent eligible events. | `server/app.ts`, `src/api.ts` |
| Settings | Target name and URL settings allow up to 2,048 characters. The reference prefix uses 1–8 uppercase ASCII letters or digits. | `server/app.ts`, `src/views/Settings.tsx` |
| Storage and repair | SQLite waits 5 seconds for a busy writer. An unfinished analysis can be reclaimed after 5 minutes. Proof and gate decisions bind to the current report revision, proposal, evidence and policy. The deterministic engine implements three fixture families. | `server/storage.ts`, `server/workflow.ts`, `server/engine/` |
| Healthcheck scope | Administrator authorisation. Website URL up to 2,048 characters. The UI offers a single page with link following off, or 4 (default), 12 and 25 pages. The API accepts 1–25. Samples above 4 also follow eligible links from subsequent pages breadth-first. Each page contributes up to 40 eligible link candidates. The server reads sequentially, respects robots rules and waits at least 250 ms between linked reads or the published crawl delay if longer. Manual-only reviews require 60 characters of observations or an imported test case. | `server/healthchecks.ts`, `server/health-pages.ts`, `src/views/Healthcheck.tsx` |
| Website reads | Public HTTP on port 80 and HTTPS on port 443. Each read allows 10 seconds, up to 3 canonical redirects and 1 MiB each for transferred and decoded content. HTML and asset acquisition share 75 seconds. Asset reads require the exact approved URL. Up to 2 website or sample reviews may run at once per service. | `server/health-transport.ts`, `server/health-pages.ts`, `server/app.ts` |
| Links and release evidence | Up to 40 distinct link details per sampled page and 40 additional status-only requests per run within the capture deadline. A 405 or 501 on HEAD permits one status-only GET from the same budget. Captured HTML supplies fragment targets. Path labels show up to 160 characters and simple fragment labels up to 80. Rendered markup up to 1 MiB can contribute additional links and targets. One permitted sitemap or index is read without following its entries. Public build and version values allow up to 80 characters. | `server/health-links.ts`, `server/health-release.ts`, `server/health-transport.ts` |
| Browser asset capture | A run shares 40 asset reads across pages and follows up to four import hops breadth-first. Static imports, re-exports, literal dynamic imports, inline import maps, CSS imports and referenced fonts use the page origin or one of seven trusted HTTPS hosts. Capture checks each origin’s robots policy, pins the public connection and requires a matching MIME type. Query-specific pages are excluded from replay. The host list, URL rules and file types are in [Website healthcheck runtime limits](RUNTIME-LIMITS.md). | `server/health-transport.ts`, `server/health-assets.ts`, `server/health-import-map.ts`, `server/health-asset-imports.ts` |
| Browser functions | 75 seconds for the browser stage, 8 seconds to launch, 5 seconds per page load, 250 ms initial settling and 2 seconds per action or expected outcome. Desktop viewport 1280 × 800. Up to 8 automatic control checks and 8 named button checks. A passing interaction requires a separate no-click observation. The report identifies loaded third-party assets and blocked requests by hostname. Cookie control classification uses up to 500 characters of nearby banner text. Contrast samples the first 100 non-empty text runs per page. Focus checks use one Tab press. Name up to 160 characters and expected text up to 240. Inventory details cover the first 100 visible buttons per page, with up to 5 untested examples of 80 characters each. Windows defaults to installed Chrome and Linux to Playwright Chromium. Set `HEALTHCHECK_BROWSER_CHANNEL` to select another installed Chromium channel. | `server/health-browser.ts`, `server/healthchecks.ts` |
| Button discovery | Reads one signed-out HTML starting page at an address without a query or fragment. Shares the two website review slots and the asset and browser limits above. Lists details for up to 100 visible buttons, grouping duplicate names. Only enabled buttons with a unique accessible name of 1–160 characters can be selected. | `server/app.ts`, `server/health-browser.ts` |
| PDF export | One saved run per A4 document. Printing uses local Chromium with an 8-second launch timeout and a 35-second rendering budget. | `server/health-pdf.ts`, `server/health-browser.ts` |
| Netlify jobs | Enabled by `RELEASEGATE_NETLIFY_JOBS=true`. The Netlify client polls immediately, then once per second. Up to 4 jobs run concurrently, with 2 per session. Up to 64 pending or retained tickets are allowed, with 16 per session. Results expire 5 minutes after completion. Each result allows 8 MiB, with 32 MiB reserved or retained in total. Request JSON allows 128 KiB plus 1 KiB for the envelope. Record identifiers in a job path allow 1–128 letters, digits, underscores or hyphens. The origin’s sessions and saved records persist in SQLite. Pending jobs and temporary results reside in one backend process. | `server/hosting-jobs.ts`, `src/netlify-jobs.ts` |
| Windows desktop inspection | Local interactive Windows installation bound to loopback. One open picker per service, 15 minutes to finish, 256 KiB maximum helper output. Save the latest completed inspection in the same signed-in session within 30 minutes. Saving consumes the capture. Restarting the service clears outstanding captures. | `server/health-windows.ts`, `server/app.ts` |
| Windows button checks | One main window per inspection, up to 100 visible buttons and 8 individually approved actions. Button names and expected element names allow 160 characters. Each action watches for 4 seconds, polling every 200 ms. A Windows automation worker has 15 seconds to respond. The API accepts an executable basename up to 255 characters, up to 16 scope notes and up to 512 characters per note or action detail. | `scripts/inspect-windows-app.ps1`, `server/healthchecks.ts` |
| Imported tests | Up to 4 MiB of Playwright JSON is parsed in the form. Up to 250 case/project outcomes go to the API. Case names including project labels can contain up to 240 characters. The standard 128 KiB HTTP request limit also applies. | `src/health-suite.ts`, `src/views/Healthcheck.tsx`, `server/healthchecks.ts` |
| Healthcheck scoring | Local results show counts for the observations in that run. The compatibility API field `readiness_indicator` rounds passes divided by passes plus failures to a percentage when scoring is possible. The legacy bands use 80% and 50% thresholds. The field `evidence_coverage` measures how many recorded observations have a pass or fail. Both denominators come solely from the recorded checks. | `server/healthchecks.ts`, `src/views/Healthcheck.tsx` |
| Model | 4,000 characters per input field, 2,048 completion tokens, 65,536 response bytes, 8 entries apiece for plan and checks, 1,500 characters per output string. One call per analysis, without automatic retries. Timeout defaults to 30 seconds, configurable from 1 to 2,147,483,647 ms. | `server/engine/llm.ts`, `server/engine/index.ts`, `LLM_TIMEOUT_MS` |
| Dashboard | Refreshes every 45 seconds. The trend uses 7 UTC days. The priority list shows up to 6 reports and 3 safety reasons for a selected report. Pulse is rounded to 0–100. An active blocker gives Guarded. Otherwise 80% or above gives Release clear. | `server/rules.ts`, `src/views/Dashboard.tsx` |
| Other screen limits | Repairs shows 3 cards per lane and up to 9 active reports in the board detail. The chart shows the last 8 versions. Settings shows 6 activity entries and a 2.6-second saved indication. Toasts last 5 seconds. | `src/views/Repairs.tsx`, `src/views/Versions.tsx`, `src/views/Settings.tsx`, `src/main.tsx` |
| Browser tests | Journey uses one worker, a 65-second test timeout and 8-second action/assertion timeouts. | `playwright.config.ts` |

Vite reports an advisory for a minified chunk over its default 500 kB warning threshold. The built client JavaScript is approximately 975 kB, or 279 kB gzipped. Vite’s build settings live in `vite.config.ts`.


## Verification

```sh
npm run typecheck
npm run build
npm test
npm run test:e2e
node scripts/audit-release.mjs
npm audit --omit=dev
```

On an interactive Windows desktop, exercise the native inspector against a disposable test application from the project folder.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\windows\desktop-inspection.ps1
```
