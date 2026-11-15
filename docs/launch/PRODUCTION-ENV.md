# Production environment (P3)

_Prepared on `launch-prep`; **the owner creates every account and key**. Sources: `apps/web/server/env.schema.ts` (+ `env.compliance.ts`), `apps/keeper/src/env.ts`, [M4-DEPLOY.md](../M4-DEPLOY.md), [keeper-operations.md](../keeper-operations.md). Values never go in git; set them in Vercel (web), in `/etc/ovelo/ovelo.env` on the self-host VPS ([§7](#7-self-host-hostinger-vps-behind-cloudflare), Phase H), or in the keeper host's secret store._

**Two supported platforms (Phase H).** Either **Vercel** (as before) or a **Hostinger VPS behind Cloudflare** ([SELF-HOST.md](./SELF-HOST.md), [HOSTINGER-RUNBOOK.md](./HOSTINGER-RUNBOOK.md)). The variables are the same; what differs is where they live, how the platform is detected and which proxy is trusted (§7).

**Check before every production deploy:**

```bash
pnpm check:prod-env --env-file <path relative to apps/web>   # or with the env already exported
pnpm check:prod-env --offline                                # skip the RPC genesis calls
pnpm check:prod-env --profile beta --env-file <path>         # Phase A: beta.<domain> (§5)
pnpm check:prod-env --profile beta --env-file <path> --platform selfhost   # Phase H: the VPS file (§7)
```

It validates the production profile with the real boot schema (on `--platform vercel`, the default, forced to `VERCEL_ENV=production`; on `--platform selfhost`, nothing is forced and the file must say `OVELO_PLATFORM=selfhost`, the profile's `OVELO_DEPLOY_ENV`, `OVELO_PROXY_MODE=cloudflare` and a valid `OVELO_ORIGIN_SECRET`), then: required variables present; no `.invalid` / `placeholder` / test values; no Cloudflare Turnstile test keys; E2E, localnet and test switches off; the compliance policy fails closed and restricts US; and each mainnet RPC answers `getGenesisHash` with mainnet's genesis (read-only). It prints **names and statuses only**. Exit 1 on any missing, invalid or forbidden item.

## 1. Web app (Vercel), by service

Milestone = when it is needed: **M9** spot and baskets live; **M10** no new variables (Path B: no Jupiter DCA; [DCA-SPIKE.md](./DCA-SPIKE.md)); **M12** Ovelo Guard on mainnet when funded (keeper, Hermes, QStash); **M7** the devnet test surfaces that ship with the app.

| Service | Variable(s) | What it is | Where to get it | Recommended plan | Needed |
|---|---|---|---|---|---|
| Blinks | `OVELO_ACTIONS` | unset = **off** under the production rules (production and beta), on elsewhere; `on` opens the Action POST, `off` closes it everywhere. A Blink client may fetch the POST through its own servers, so the geo gate can see the client's country, not the user's: keep it off until counsel agrees (COMPLIANCE §1) | — | — | launch |
| Emergency stop | `OVELO_TRADING` | `on` (default) or `off`: `off` refuses every mainnet trading entry point with 503, nothing else (M9; replaces the removed `OVELO_V1_ENABLED` flag; boot now always validates the environment) | — | — | M9 |
| Domain | `OVELO_SITE_URL` | canonical `https://` origin: HTTPS redirect, metadata, the `Site:` line of every wallet challenge, Action links | Vercel project → Domains; DNS at the registrar | — | M9 |
| Vercel | `VERCEL`, `VERCEL_ENV` (set by Vercel) | platform detection, read only by `server/platform.ts`; on Vercel the proxy mode defaults to `vercel` (`x-vercel-ip-country`, `X-Real-IP` trusted) | Vercel project (Git integration on `main` only) | **Pro** (team, protection, analytics, longer functions; `maxDuration` 60 s routes) | M9 |
| Platform (Phase H) | `OVELO_PLATFORM`, `OVELO_DEPLOY_ENV` | leave **unset on Vercel** (`OVELO_DEPLOY_ENV=beta` may refine a Vercel production deployment); self-host: `selfhost` + `production`/`beta`, both required. A production boot without a platform answer, or with a contradiction, is refused | — | — | Phase H |
| Proxy (Phase H) | `OVELO_PROXY_MODE`, `OVELO_ORIGIN_SECRET` | `vercel` (default on Vercel) / `cloudflare` (required on self-host production and beta, with the origin secret the Cloudflare Transform Rule sends) / `none`. **Replaces `OVELO_TRUST_PROXY`, which now refuses to boot: remove it from every environment** | `openssl rand -base64 48` for the secret | — | Phase H |
| Vercel | `OVELO_ALLOWED_ORIGINS` | extra exact browser origins for the API | — | usually unset | optional |
| Paid RPC (primary) | `SOLANA_RPC_URL` | server mainnet RPC; genesis verified before every trade operation | Helius or Triton dashboard; API key in the URL path/query (never as `user:pass@`) | Helius **Business** or Triton dedicated (sendTransaction + simulate at trade volume; staked connections) | M9 |
| Paid RPC (browser) | `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_WS_URL` | wallet stack RPC; becomes a CSP `connect-src` entry; public in the bundle | same provider: a **separate, domain-restricted** key | origin-locked key | M9 |
| RPC failover | `SOLANA_RPC_FALLBACK_URL` | a second server mainnet RPC used only when the primary cannot answer ([§3](#3-rpc-failover-implemented-m9)); same rules as `SOLANA_RPC_URL`, must differ from it; `check:prod-env` warns when it is missing or on the primary's host | a **different provider**: Triton if the primary is Helius, or vice versa | the provider's paid tier, server key | M9 (recommended) |
| Jupiter | `JUPITER_API_KEY` | Swap API v2 `/build` and Price v3; comma-separated keys rotate. Keyless: production quotes return `TRADING_UNAVAILABLE` and most assets are unpriced | portal.jup.ag | a paid tier sized for quote volume | M9 |
| Jito | `JITO_BLOCK_ENGINE_URL`, `JITO_AUTH_UUID`, `JITO_MAX_TIP_LAMPORTS` | bundles for multi-transaction baskets; unset = such baskets refused (no partial order) | `https://mainnet.block-engine.jito.wtf/api/v1/bundles`; UUID from Jito if rate-limited | default public block engine; UUID if needed | M9 (recommended) |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limits, trade idempotency, single-use challenge nonces (creator, terms); without it trading is unavailable | console.upstash.com → Redis, region next to Vercel's | **Pay as you go** with eviction **off** (nonces must not be evicted) | M9 |
| Neon Postgres | `DATABASE_URL` | receipts, creators, baskets, `terms_acceptances`; run `pnpm db:migrate` (now through `0004`) | console.neon.tech; pooled connection string, `sslmode=require` | **Launch** (point-in-time restore, no autosuspend on the production branch) | M9 |
| Trade HMAC | `OVELO_TRADE_SECRET`, `OVELO_TRADE_SECRET_PREVIOUS` | HMAC key for trade authorizations (32+ random chars); previous only during a rotation ([KEY-CUSTODY.md §3](./KEY-CUSTODY.md#3-ovelo_trade_secret-rotation)) | generate: `openssl rand -base64 48` | — | M9 |
| Sentry | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` (build only) | errors and trade breadcrumbs (scrubbed); the auth token uploads source maps. Both DSNs must have the exact shape `https://<32-hex public key>@o<org>.ingest[.<region>].sentry.io/<project>` (`server/env.sentry.ts`); anything else stops boot | sentry.io project; the auth token is a Vercel build-time secret | **Team** | M9 |
| ~~Privy~~ | none: **removed** (REWRITE-PLAN §7.3 W1, wallet-only login). Do not create a Privy app. | | | | |
| Revalidate | `OVELO_REVALIDATE_SECRET` | bearer for `POST /api/v1/revalidate`; unset = 503 | `openssl rand -base64 48` | — | M9 (recommended) |
| Pyth | `PYTH_API_KEY` | Hermes (prices, health probe); Hermes answers 401 without a key | Pyth Pro / Hermes access | per provider | M12 (web: recommended at M9) |
| Analytics | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | consent-gated analytics | plausible.io | — | optional |
| Operator | `OVELO_OPERATOR_NAME`, `OVELO_SUPPORT_EMAIL` | legal pages' contact block | owner | — | M9 |
| Beta gate (Phase A) | `OVELO_BETA_GATE`, `OVELO_BETA_WALLETS` | private-beta access ([BETA-ACCESS.md](./BETA-ACCESS.md)): `on` for `beta.<domain>`, `off` at Phase B; optional wallet allowlist | — | — | Phase A |
| Trade caps (Phase A) | `OVELO_MAX_TRADE_USDC_RAW`, `OVELO_MAX_DAILY_USDC_RAW` | per-trade and per-wallet daily caps in raw USDC units ([TRADE-CAPS.md](./TRADE-CAPS.md)); **required in production**, 0 refused | — | — | Phase A |
| Compliance | `OVELO_COMPLIANCE_*`, `OVELO_TERMS_VERSION` | jurisdiction policy overrides ([COMPLIANCE.md §2](./COMPLIANCE.md#2-configuration-not-code)); leave unset for the defaults; never `MISSING_COUNTRY=allow` | counsel's final list | — | M9 |
| Terms gate | `OVELO_ALLOW_PLACEHOLDER_TERMS` | the boot refuses production while the selected terms are `final: false`; a beta (`OVELO_DEPLOY_ENV=beta`, also on Vercel) may set `true` to run on the placeholder; refused in production | — | — | launch |
| Turnstile | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | the devnet faucet's human check; test keys refused in production | Cloudflare → Turnstile, hostname = the domain | free | M7 (devnet surface) |
| Devnet surface | `OVELO_RECURRING_RPC_URL`, `NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL`, `OVELO_V1_INVEST_CLUSTER=devnet`, `OVELO_V1_FAUCET_KEYPAIR`, `OVELO_V1_FAUCET_DAILY_CLAIMS` | `/v1/invest` on devnet and its faucet (devnet-only key, never the deployer) | devnet RPC (paid devnet endpoint recommended); faucet key per KEY-CUSTODY | — | M7 |

**Must be unset in production** (`check:prod-env` and the boot schema refuse them): `OVELO_V1_ALLOW_TEST_SWITCHES`, `OVELO_V1_TEST_FORK_GENESIS`, `OVELO_V1_TEST_JUPITER_URL`, `OVELO_V1_SIMULATE_UPSTREAM_OUTAGE`, `NEXT_PUBLIC_OVELO_E2E_WALLET=true`, `NEXT_PUBLIC_OVELO_LOCALNET=true`, `OVELO_V1_LOCALNET_*`, `OVELO_LOCAL_NEON_WS_PROXY`, `OVELO_SKIP_ENV_CHECK`, and `OVELO_V1_INVEST_CLUSTER=localnet`.

Prototype-only variables (`OVELO_RECURRING_AUTH_SECRET`, `OVELO_FAUCET_SECRET_KEY`, `CREATOR_AUTH_SECRET`, `CREATOR_INVITE_CODES`, `BOT_KEYPAIR`) are removed with the prototype in M9; do not set them for v1.

## 2. Keeper (`apps/keeper`), M12

The keeper is **devnet-only** today (`KEEPER_CLUSTER` is `devnet` or `localnet`; the mainnet path is M8's work). This table lists what the mainnet keeper will need; `check:prod-env` does not validate the keeper yet (the mainnet keeper schema does not exist until M8 lands).

| Service | Variable(s) | What it is | Where | Recommended plan | Needed |
|---|---|---|---|---|---|
| Host | `KEEPER_PORT`, `KEEPER_PUBLIC_URL` | the `POST /run` URL QStash calls (checked against the signature `sub`) | Railway, Fly or a container host with a secret store | always-on small instance | M12 |
| Keeper key | `KEEPER_KEYPAIR` | the mainnet keeper signer; `keeper_authority` in config; holds only fee SOL | generated offline by the owner ([KEY-CUSTODY.md](./KEY-CUSTODY.md)) | — | M12 |
| RPC | `KEEPER_RPC_URL` | mainnet RPC with the genesis guard | paid RPC (separate key from the web app) | | M12 |
| Hermes | `HERMES_URL`, `PYTH_API_KEY` | price updates for installments | Pyth | | M12 |
| QStash | `QSTASH_TOKEN` (web, to schedule), `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | schedule every 1–5 minutes; signature verification with rotation | console.upstash.com → QStash | **Pay as you go** | M12 |
| Redis, Postgres | `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `DATABASE_URL` | leases, dead letters, `plans_index`, receipts | the same Upstash and Neon projects (separate credentials if possible) | | M12 |
| Alerts | `KEEPER_ALERT_WEBHOOK_URL`, `KEEPER_ALERT_FORMAT` | failed/skipped installments, low balance, DLQ | Slack or Discord incoming webhook | | M12 |
| Tuning | `KEEPER_MIN_SOL_LAMPORTS`, `KEEPER_PRIORITY_MICROLAMPORTS`, `KEEPER_MAX_PLANS_PER_RUN`, `KEEPER_DLQ_ALERT_THRESHOLD`, `KEEPER_MAX_ATTEMPTS` | defaults are documented in `env.ts` | — | | M12 |
| Collector | `OVELO_RECURRING_EXECUTOR_SECRET` | bearer for the collector endpoint; separate from every other secret | `openssl rand -base64 48` | | M12 |

## 3. RPC failover (implemented, M9)

Implemented on branch `phase-b-cutover` (REWRITE-PLAN M9 / Phase B, Step 2). Code: `apps/web/features/trade/server/rpc-pool.ts` (the rules), `rpc.ts` (the endpoints from the environment), `submit.ts` (the re-send), `deps.ts` (the wiring), `rpc-health.ts` (`/api/v1/health`).

1. **Config.** `SOLANA_RPC_FALLBACK_URL` is optional and validated like `SOLANA_RPC_URL`: HTTPS, no userinfo, not devnet- or testnet-looking; loopback only for the declared local-fork E2E (test switches, refused in production). It must differ from the primary (boot refuses an identical URL; `check:prod-env` also warns when both are on the same host, because then failover does not cover a provider outage). Without it, behaviour is the single-endpoint behaviour of M4.
2. **Genesis per endpoint.** Every endpoint, the primary included, proves the mainnet genesis with its own `getGenesisHash` before it serves any call, cached per URL for 60 s. The fallback is never assumed to be mainnet because the primary was. A fallback with another genesis is never used; it writes an **alert**, also from the health check, so a misconfigured fallback is reported before it is needed (an error log line and a Sentry event, `alert rpc.wrong_cluster`). A primary with another genesis stops trading (`WRONG_CLUSTER`): no failover around a misconfiguration.
3. **When it fails over.** Only on transport errors, timeouts (also while reading the body), HTTP 5xx and HTTP 429. **Never on a JSON-RPC error answer**: a failed simulation or a refused `sendTransaction` comes back as it is. A 4xx that is not JSON (for example a revoked key's 401 page) does not fail over either. Only a well-formed JSON-RPC error (an object with a numeric `code`) counts as a refusal; any other error body is treated as unknown, so a send it answers is never recorded as `failed`. A failing endpoint goes to the back of the queue for 30 s.
4. **Affinity.**
   - A quote pins one endpoint at its first answer: its `getLatestBlockhash`, simulation, lookup-table and account reads all come from that node. If that node fails mid-quote, the quote fails and the user re-quotes.
   - Submit runs its preflight (genesis, V1 activation, block height) and the send on one pinned endpoint. If `sendTransaction` fails **in transport**, the **same signed string** is re-sent to the other endpoint (idempotent by signature; nothing is re-signed or rebuilt). A JSON-RPC refusal of the first send is final (`failed`). After an uncertain first send, any outcome of the re-send other than acceptance is `unknown`, never `failed`: the first send may have reached the cluster.
   - Confirmation polling may read either endpoint, but each poll reads its signature status and block height from one node. A single transaction with no status anywhere once the chain (finalized) is past the blockhash's `lastValidBlockHeight` can never land: the trade becomes `failed` (`BLOCKHASH_EXPIRED`) and polling stops. That conclusion is drawn only within 150 block heights after the expiry, while every node's in-memory status cache still covers the blockhash; later, a missing status may only mean the node lacks history (or a history lookup failed silently), so the record keeps its status and is never called `failed` from an absence of evidence. Baskets keep their M4 rule (`unknown` past expiry).
   - Jito bundles and the browser wallet RPC are unchanged.
5. **Health and alerts.** `GET /api/v1/health` has one `rpc` check with facts for both endpoints: `primary` and `fallback` status (`ok`, `degraded`, `down`, `skipped` when no fallback is set) and `fallbackInUse` (this instance's view). Since Phase H the public body has statuses only: each endpoint's slot and slot age go to the logs (`health check not ok`), not to the internet. Overall it is the better endpoint's status, and `degraded` while the other configured endpoint is unhealthy. No URL or host appears. Every request the fallback serves writes a structured log line and a Sentry breadcrumb (`rpc.fallback_served`); a re-sent transaction writes `submit.resend`.
6. **Tests.** Unit tests for each rule (`rpc-pool.test.ts`), the submit paths (`submit.failover.test.ts`), health (`rpc-health.test.ts`) and config (`server/env.rpc-fallback.test.ts`); two `fast-check` properties: for any sequence of endpoint failures the bytes sent are always the signed bytes and a refused send is never sent again, and the pool never retries a JSON-RPC error answer elsewhere. The fork E2E (`e2e/trade/failover.spec.ts`) runs the app through two loopback proxies in front of one local validator: a wrong-cluster fallback is refused with the primary down, the primary stopped between quote and submit still confirms with the exact signed bytes, and a send whose answer the primary drops is re-sent to the fallback and debits once.

**Owner:** set `SOLANA_RPC_FALLBACK_URL` to a second provider's server key (P3), then run `pnpm check:prod-env` (it checks both genesis hashes, read-only). Alert on `alert rpc.wrong_cluster` and on a sustained `rpc.fallback_served` rate.

## 4. Owner order of operations (spot launch, M9)

1. Vercel Pro project on `main` only; domain; `OVELO_SITE_URL`.
2. Neon (Launch): production branch, `DATABASE_URL`, then `pnpm db:migrate` from a trusted machine.
3. Upstash Redis (eviction off).
4. Helius or Triton: two keys (server, browser origin-locked); a second provider account for failover.
5. Jupiter API key; Jito URL.
6. Sentry project, operator contact. (No Privy app: wallet-only login, REWRITE-PLAN §7.3 W1.)
7. Generate `OVELO_TRADE_SECRET` and `OVELO_REVALIDATE_SECRET` directly into Vercel's env UI (never in a file in the repo).
8. `pnpm check:prod-env` against the Vercel production env (`vercel env pull` into a file **outside** the repo, run the check, delete the file).

## 5. Phase A: `beta.<domain>` (private beta)

A **separate Vercel project** for `beta.<domain>`, built from the merged tip (needs P6), with its own env. The prototype stays on the main domain. Validate it with `pnpm check:prod-env --profile beta --env-file <file outside the repo>`: the production profile, plus the beta gate set to `on` explicitly, both caps set (above $50 / $200 warns), **no browser-visible variable v1 does not read** (the prototype's `NEXT_PUBLIC_PRIVY_APP_ID` is refused: v1 is wallet-only, W1), `OVELO_SITE_URL` on a `beta.` host (warning), and each mainnet RPC's genesis (read-only `getGenesisHash`).

Every variable the owner sets for `beta.<domain>`:

| Service | Variable(s) | Value / where | Required |
|---|---|---|---|
| Emergency stop | `OVELO_TRADING` | `on` (unset = on); `off` pauses trading | no |
| Domain | `OVELO_SITE_URL` | `https://beta.<domain>` | yes |
| Mainnet RPC (server) | `SOLANA_RPC_URL` | paid Helius or Triton key (path/query, never `user:pass@`) | yes |
| Mainnet RPC (browser) | `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_WS_URL` | a separate, origin-locked key for `beta.<domain>` | yes (WS optional) |
| Neon | `DATABASE_URL` | pooled, `sslmode=require`; then `pnpm db:migrate` (through `0009_fee_share_ledger`, M11) | yes |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | eviction **off** (single-use nonces) | yes |
| Trade HMAC | `OVELO_TRADE_SECRET` | `openssl rand -base64 48`, straight into Vercel | yes |
| Jupiter | `JUPITER_API_KEY` | portal.jup.ag (keyless → `TRADING_UNAVAILABLE`) | yes |
| Beta gate | `OVELO_BETA_GATE`, `OVELO_BETA_WALLETS` | `on`; allowlist optional | gate yes |
| Caps | `OVELO_MAX_TRADE_USDC_RAW`, `OVELO_MAX_DAILY_USDC_RAW` | `50000000`, `200000000` | yes |
| Sentry | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` (build) | the project's DSN (`https://<key>@o<org>.ingest[.<region>].sentry.io/<project>`), environment `beta` | DSNs yes |
| Turnstile | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | hostname `beta.<domain>`; never Cloudflare's test keys | recommended (devnet faucet) |
| Alerts | Sentry alert rules (web errors, `quote.refused`/`submit.refused` spikes) to the owner's channel; `KEEPER_ALERT_WEBHOOK_URL` on the **devnet** keeper host | Slack or Discord incoming webhook | recommended |
| Devnet surface | `OVELO_RECURRING_RPC_URL`, `NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL`, `OVELO_V1_INVEST_CLUSTER=devnet`, `OVELO_V1_FAUCET_KEYPAIR`, `OVELO_V1_FAUCET_DAILY_CLAIMS` | as §1 (devnet-only key, never the deployer) | for `/v1/invest` |
| Recommended | `JITO_BLOCK_ENGINE_URL`, `OVELO_REVALIDATE_SECRET`, `PYTH_API_KEY`, `OVELO_OPERATOR_NAME`, `OVELO_SUPPORT_EMAIL`, `OVELO_COMPLIANCE_*` (counsel's list) | as §1 | — |

**Must be unset on the beta** (in addition to the production list above): `NEXT_PUBLIC_PRIVY_APP_ID` and any other prototype-only variable (`OVELO_RECURRING_AUTH_SECRET`, `OVELO_FAUCET_SECRET_KEY`, `CREATOR_AUTH_SECRET`, `CREATOR_INVITE_CODES`, `BOT_KEYPAIR`). The owner's checklist, in order: [BETA-RUNBOOK.md](./BETA-RUNBOOK.md).


## 6. M11 launch features (beta and production)

All optional unless stated; `pnpm check:prod-env` (both profiles) reports each. A half-set channel, a channel without the worker secret in production, the E2E sink and a non-zero platform fee stop the boot.

| Service | Variables | Value | Required |
|---|---|---|---|
| Periodic worker (QStash schedule, every minute, to `POST /api/v1/notifications/deliver`) | `OVELO_NOTIFY_WORKER_SECRET` | `openssl rand -base64 48`; sent as `Upstash-Forward-Authorization: Bearer …` | yes once a channel is set; recommended anyway (it also writes the fee-share ledger) |
| Pause switch | `OVELO_NOTIFICATIONS` | `on` (default) or `off` | — |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `pnpm --filter @ovelo/web notify:vapid` on the owner's machine; subject `mailto:` the operator | all three or none |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` | @BotFather; `openssl rand -hex 32`; then `setWebhook` (BETA-RUNBOOK §4) | all three or none |
| Email | — | not in this build (no email address is collected) | — |
| Analytics | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | the site's own host; events only after consent | — |
| Fees | `OVELO_PLATFORM_FEE_BPS`, `OVELO_CREATOR_FEE_SHARE_BPS` | `0` or unset; share 0–10000 (ledger only) | — |

**Must be unset in production:** `OVELO_V1_TEST_NOTIFY_SINK_URL` (E2E only).

## 7. Self-host (Hostinger VPS behind Cloudflare)

Phase H. The contract is [SELF-HOST.md](./SELF-HOST.md), and the owner's steps are [HOSTINGER-RUNBOOK.md](./HOSTINGER-RUNBOOK.md). The variables are those of §1, §5 and §6, plus the following:

| Topic | Vercel | Self-host |
|---|---|---|
| Where runtime variables live | Vercel project env | `/etc/ovelo/ovelo.env` (root, 0600), template [`deploy/hostinger/ovelo.env.example`](../../deploy/hostinger/ovelo.env.example) |
| Platform | `VERCEL`, `VERCEL_ENV` (Vercel) | `OVELO_PLATFORM=selfhost`, `OVELO_DEPLOY_ENV=beta\|production` |
| Client IP and country | `X-Real-IP`, `x-vercel-ip-country` (`OVELO_PROXY_MODE` unset or `vercel`) | `CF-Connecting-IP`, `CF-IPCountry` only (`OVELO_PROXY_MODE=cloudflare`), behind the origin lock (`OVELO_ORIGIN_SECRET`) |
| `NEXT_PUBLIC_*` | Vercel env (build time) | GitHub **repository variables**, baked into the image by `image.yml`. One image per set of public values |
| `SENTRY_AUTH_TOKEN` | Vercel build secret (source maps) | not used: the image build never receives a secret. Server stack traces still reach Sentry, but browser source maps aren't uploaded unless you add a separate upload step |
| Migrations | `pnpm db:migrate` from a trusted machine | `deploy.sh` runs them as a one-shot container with the **migration role** in `/etc/ovelo/migrate.env`. The app role (`ovelo_app`) has DML only ([HOSTINGER-RUNBOOK.md](./HOSTINGER-RUNBOOK.md) §5) |
| Tunnel | — | the Cloudflare Tunnel token in `/etc/ovelo/tunnel-token` (0400, UID 65532), never an env variable |
| Deploys and rollback | Git integration; Instant Rollback | the signed image digest: `deploy.sh <digest>`, `rollback.sh` |
| Function limits | `maxDuration` per route | no per-request limit. The SIGTERM drain is 65 s, above the 60 s routes |
| Never set | `OVELO_TRUST_PROXY` | the same, plus everything in the "never on the VPS" list in [SELF-HOST.md](./SELF-HOST.md) §2 |

