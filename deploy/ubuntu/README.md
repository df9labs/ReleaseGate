# ReleaseGate on Ubuntu

This directory is the private Ubuntu build context. The `netlify-site` directory in the release kit contains the public website. Keep this backend directory on the server.

## Start the backend

1. Point the DNS A record for the proposed API hostname, `api.releasegate.example.com`, at the Ubuntu server. If publishing an AAAA record, route that IPv6 address to the same server. Allow inbound TCP ports 80 and 443 for Caddy. Set up the separate frontend hostname, `releasegate.example.com`, in Netlify.
2. Install Docker Engine with the Compose plugin and Python 3. Copy this whole directory to persistent storage on Ubuntu and open a terminal there. These commands assume ports 80 and 443 are available on the host. [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/) · [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https)
3. Generate the local configuration and start the services.

```sh
bash setup.sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

The setup command uses those two DNS names and the initial login `admin@releasegate.local`. It creates a private `.env` with a generated 64-character hexadecimal administrator password. Read it on the Ubuntu host and transfer the login to your password manager. The setup command refuses to replace an existing file. Subsequent starts use the saved accounts and data. The dashboard starts with empty records.

To choose different settings before first boot, supply the frontend origin, API origin and administrator email in that order. Match the API origin to the proxy rules in the Netlify package. Use the exact public HTTPS frontend origin for `PUBLIC_ORIGIN`.

```sh
bash setup.sh https://releasegate.example.com https://api.releasegate.example.com admin@releasegate.local
```

The optional `LLM_API_KEY`, `LLM_ENDPOINT` and `LLM_MODEL` belong in the backend's private `.env`. Add them if you want a model-backed repair proposal. Website checks, PDF export and the deterministic repair loop work without a provider key. After changing environment settings run `docker compose up -d` again. Existing accounts retain the password saved in the database.

## Verify the installation

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://api.releasegate.example.com/api/auth/session
curl -sS -o /dev/null -w '%{http_code}\n' https://releasegate.example.com/api/auth/session
```

Both commands should return `401` when called without a sign-in cookie. A `200` HTML response on the frontend URL usually means the single-page app fallback is intercepting the API. Check the Netlify proxy rule order. A TLS failure or a `502` points to DNS, certificates or service availability. Inspect the services with `docker compose ps` and `docker compose logs --tail=100 app caddy`.

Test the container's Chromium sandbox before the first website Healthcheck.

```sh
docker compose exec -T app node --input-type=module -e "import {chromium} from 'playwright'; const browser = await chromium.launch({chromiumSandbox:true}); await browser.close(); console.log('Sandboxed Chromium started.');"
```

Sign in at the **Netlify frontend**, run the built-in sample Healthcheck with its example button checks and export the result as a PDF. The sample includes a working disclosure and a deliberately inert button. A remote website Healthcheck uses the Ubuntu server's network connection. Windows executable inspection runs on a local Windows installation.

## Apply a changed administrator password

After the initial installation, ReleaseGate verifies sign-ins against the password hash saved in SQLite. If you change `DEMO_ADMIN_PASSWORD` in the Ubuntu deployment’s private `.env`, use the following command from the directory containing the live `compose.yaml`. The file `apply-admin-password.mjs` ships with the private deployment kit and can also be copied into an existing installation on its own.

```sh
docker compose run --rm --no-deps -T app node --input-type=module - < apply-admin-password.mjs
```

The one-off container reads the current Compose configuration and mounts the existing data volume. The tool updates the administrator matching `DEMO_ADMIN_EMAIL` and expires that account’s previous sessions and recovery links. If the password already matches it leaves those sessions in place. The command keeps passwords out of its output and preserves saved reports. Sign in using the address and password from the Ubuntu configuration.

## Operation and limits

The containers share an internal Docker network. Caddy publishes the API and sample routes over HTTPS. The app container has no published host port. The SQLite database and any backend data live in the `releasegate-data` named volume. Caddy keeps certificates and configuration in its own named volumes. Keep these volumes when updating the application. Before upgrading, stop writes and back up the entire data volume or take a consistent SQLite online backup. Protect the backend `.env` separately.

| Setting | Value and location |
| --- | --- |
| Sandbox and memory | The app runs as the unprivileged `node` user. `compose.yaml` allocates 512 MiB of shared memory and selects the included Chromium seccomp profile. Host security policies must permit the browser's user-namespace sandbox. If the launch check fails, inspect the host kernel and AppArmor logs with the server administrator. [Playwright container guidance](https://playwright.dev/docs/docker) |
| Service availability | The readiness check polls the signed-out session endpoint every 30 seconds, allows 5 seconds per attempt and 3 retries after a 20-second start period. Change these values in `compose.yaml`. |
| Netlify background jobs | `RELEASEGATE_NETLIFY_JOBS=true` in `compose.yaml` enables the hosted client's polling transport. Use one app instance behind Caddy. An application restart clears in-flight jobs and temporary polling results. Completed Healthchecks are stored in SQLite. |

The [runtime limits](RUNTIME-LIMITS.md) cover job concurrency and retention, authentication, rate limits, website reads, browser checks, PDF rendering and the locations of the corresponding settings.

The included `chromium-seccomp.json` is Playwright's Docker seccomp profile, with its Apache licence and notices alongside it. It permits the namespace operations Chromium needs while retaining a default-deny system-call filter. [Profile source at the packaged revision](https://github.com/microsoft/playwright/blob/ae935a43d9e376e4759548f6b3c6905c7b282333/utils/docker/seccomp_profile.json)
