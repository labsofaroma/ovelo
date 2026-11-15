# Self-host runtime contract (Phase H)

How the Aroma web image runs on a VPS behind Cloudflare. This is the contract between the image (`deploy/Dockerfile`), the compose bundle (`deploy/hostinger/`) and the owner's runbook ([HOSTINGER-RUNBOOK.md](HOSTINGER-RUNBOOK.md)). The Vercel path stays supported; [PRODUCTION-ENV.md](PRODUCTION-ENV.md) covers both platforms.

## 1. What the image is

- **Base:** the official `node:24.12.0-slim` (Debian bookworm, glibc), pinned by index digest. Dependabot bumps the digest (Step 6).
- **App:** Next's traced standalone server (`output: "standalone"`, only for this image) with sharp for `next/image`. It has no package manager (npm, npx, corepack and yarn are removed) and no dev dependencies.
- **User:** UID and GID 10001 (`aroma`, no shell, no home).
- **Entry point:** `node /app/deploy/server.mjs` starts the standalone server behind a bounded graceful shutdown.
- **Labels:** `org.opencontainers.image.revision` (commit) and `.version`. The same values are in the env as `AROMA_REVISION` and `AROMA_VERSION`, and Sentry's release is `aroma-web@<revision>`.
- **Build inputs:** only `NEXT_PUBLIC_*` build args, which end up in the browser bundle and are public by definition. **One image therefore matches one set of public values.** If beta and production differ in a `NEXT_PUBLIC_*` value (RPC URL, Sentry DSN, Turnstile site key, analytics domain), build one image per set. No secret is ever a build arg, an `ENV` or a layer, and the client-secret scan runs inside the build.

## 2. Environment (`/etc/aroma/aroma.env`, mode 0600)

The authoritative template is [`deploy/hostinger/aroma.env.example`](../../deploy/hostinger/aroma.env.example), which has every variable and marks the secrets. The app **refuses to boot** with the variable names (never values) when:
- `AROMA_PLATFORM=selfhost` or `AROMA_DEPLOY_ENV` is missing, or contradicts Vercel's variables;
- a self-host production or beta deployment doesn't use `AROMA_PROXY_MODE=cloudflare`;
- `AROMA_ORIGIN_SECRET` is missing, shorter than 32 characters, or equal to another secret;
- the removed `AROMA_TRUST_PROXY` is still set;
- any production rule fails: test switches, fork, localnet, E2E wallet, Turnstile test secrets, missing caps, the beta profile, notification secrets.

Run `pnpm check:prod-env --env-file <file> --profile beta|production --platform selfhost` before every deploy.

| Group | Variables | Secret |
|---|---|---|
| Platform | `AROMA_PLATFORM=selfhost`, `AROMA_DEPLOY_ENV=beta\|production` | no |
| Edge | `AROMA_PROXY_MODE=cloudflare`, `AROMA_ORIGIN_SECRET` | **secret** (it also sits in the Cloudflare Transform Rule) |
| Site | `AROMA_SITE_URL`, `AROMA_ALLOWED_ORIGINS`, `AROMA_OPERATOR_NAME`, `AROMA_SUPPORT_EMAIL` | no |
| Chain | `SOLANA_RPC_URL`, `SOLANA_RPC_FALLBACK_URL` | **secret** if the URL embeds an API key |
| Data | `DATABASE_URL` (the `aroma_app` role), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | **secret** (URL and token) |
| Trading | `AROMA_TRADE_SECRET`, `AROMA_TRADE_SECRET_PREVIOUS`, `AROMA_TRADING`, `AROMA_MAX_TRADE_USDC_RAW`, `AROMA_MAX_DAILY_USDC_RAW`, `JUPITER_API_KEY`, `JITO_*`, fee bps | **secret**: trade secrets, Jupiter key, `JITO_AUTH_UUID` |
| Gates | `AROMA_BETA_GATE`, `AROMA_BETA_WALLETS`, `AROMA_COMPLIANCE_*`, `AROMA_TERMS_VERSION` | no |
| Notifications | `AROMA_NOTIFICATIONS`, `AROMA_NOTIFY_WORKER_SECRET`, `VAPID_*`, `TELEGRAM_*`, `QSTASH_*` | **secret**: worker secret, VAPID private key, Telegram token and webhook secret, QStash token and signing keys |
| Ops | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `LOG_LEVEL`, `AROMA_REVALIDATE_SECRET`, `PYTH_API_KEY` | **secret**: revalidate secret, Pyth key |
| Devnet test | `AROMA_RECURRING_RPC_URL`, `AROMA_V1_INVEST_CLUSTER=devnet`, `AROMA_V1_FAUCET_*`, `TURNSTILE_SECRET_KEY` | **secret**: faucet keypair (devnet only, never a mainnet key), Turnstile secret |

Never on the VPS: `SENTRY_AUTH_TOKEN` (CI only), every `AROMA_V1_TEST_*` and `AROMA_V1_LOCALNET_*`, `AROMA_LOCAL_NEON_WS_PROXY`, `AROMA_SKIP_ENV_CHECK`, `AROMA_TRUST_PROXY`, and any keypair of a funded mainnet wallet. The server holds no user keys; users sign in their wallets.

The migration role's `DATABASE_URL` lives in a **separate** file, `/etc/aroma/migrate.env`, read only by `deploy.sh`'s one-shot migration container.

## 3. Network and ports

- **Port 3000** inside the container (`HOSTNAME=0.0.0.0`, so `cloudflared` reaches it on the internal Docker network). Compose publishes **nothing** to the host, and the VPS firewall allows no inbound 80/443. The only way in is the outbound-only Cloudflare Tunnel.
- **Origin lock:** every request needs `x-aroma-origin: <AROMA_ORIGIN_SECRET>`, which the Cloudflare Transform Rule sets. Anything else gets 403 `ORIGIN_REFUSED`. Only the public asset folders (`/images/`, `/fonts/`, `/company-logos/`, `/token-logos/`, `/xstocks-devnet/`) and `/_next/static/` skip middleware: they're public, read-only files.
- **Egress** (the app's own network): Neon, Upstash (Redis and QStash), the RPC providers, Jupiter, Pyth Hermes, Jito, Sentry, Telegram and web-push endpoints, and the market-data providers.
- **Trust:** the client IP is `CF-Connecting-IP`, the country is `CF-IPCountry`, and nothing else is read (`server/proxy.ts`). `XX` and Tor's `T1` count as an unknown country, so trading is refused.

## 4. Filesystem

| Path | Mode | Size limit | What |
|---|---|---|---|
| `/` | **read-only** (`read_only: true`) | — | the image |
| `/tmp` | tmpfs, `noexec,nosuid` | 64 MiB | scratch |
| `/app/apps/web/.next/cache` | named volume `aroma-next-cache`, owned by 10001 | see §6 (disk alert) | the image optimizer cache and the data cache (`unstable_cache`). Safe to delete: it's rebuilt on demand |

Proven locally (Phase H Step 3): pages, the data cache, `actions.json`, liveness and readiness run on a read-only root with zero `EROFS`, and the container itself can't write to `/app`.

## 5. Health, signals and logs

- **Liveness:** `GET /api/v1/health/live` → `{"status":"ok"}`. It checks only the process and skips the rate limiter, so a Redis outage doesn't restart the app; the origin lock still applies. Docker's `HEALTHCHECK` (`deploy/healthcheck.mjs`, every 15 s, 40 s start period) calls it on loopback with the secret from the container env.
- **Readiness:** `GET /api/v1/health` is for the external uptime monitor. It returns 200 when nothing is down and 503 otherwise. The body has only `ok`, `degraded`, `down` or `skipped` per dependency, plus the RPC failover facts (`primary`, `fallback`, `fallbackInUse`). No latency, slot, version, host or key. The full report is logged at `warn` when not ok.
- **SIGTERM:** the server stops accepting connections, lets in-flight requests finish for up to **65 s** (above the 60 s budget of trade quote, trade submit and the Action POST), closes the Postgres pool, and exits 0, or 1 if the deadline cut something. Compose's `stop_grace_period` is **75 s**. A trade submit cut at the deadline is safe to retry: its request id is claimed before anything is broadcast, so a retry returns the stored record and never broadcasts twice (`apps/web/server/graceful.test.ts`).
- **Logs:** one JSON object per line on stdout, with no log files. Docker's `json-file` driver rotates them (§6). The logger redacts authorization, cookies, the origin header, every secret-named key, client-IP fields and headers, and contact details (`observability/scrub.ts`). No IP is logged.

## 6. Resources and the single-instance rule

- **One app container.** Next's page cache, data cache and image cache are on the local volume, and the rate limiter, trade idempotency and caps live in Upstash. A second instance would serve different cached data. Horizontal scaling needs a shared cache handler, which is out of scope. Compose runs exactly one `app` replica.
- **Limits** (compose): `mem_limit: 1g`, `cpus: 1.5`, `pids_limit: 256`, `cap_drop: [ALL]`, `no-new-privileges`. These are sized from Step 8's measurements; see [§7](#7-measured).
- **Logs:** `max-size: 20m`, `max-file: 5` per container (at most about 100 MB each).
- **VPS:** Hostinger KVM 2 (2 vCPU, 8 GB) or larger. The deploy pulls by digest, so the VPS never builds.

## 7. Measured

Filled in by Phase H Step 8: image size, cold start, and memory under the fork E2E load.
