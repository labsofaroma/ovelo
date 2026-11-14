# Production environment (P3)

_Prepared on `launch-prep`; **the owner creates every account and key**. Sources: `apps/web/server/env.schema.ts` (+ `env.compliance.ts`), `apps/keeper/src/env.ts`, [M4-DEPLOY.md](../M4-DEPLOY.md), [keeper-operations.md](../keeper-operations.md). Values never go in git; set them in Vercel (web) or the keeper host's secret store._

**Check before every production deploy:**

```bash
pnpm check:prod-env --env-file <path relative to apps/web>   # or with the env already exported
pnpm check:prod-env --offline                                # skip the RPC genesis calls
pnpm check:prod-env --profile beta --env-file <path>         # Phase A: beta.<domain> (§5)
```

It validates the production profile with the real boot schema (forced to `VERCEL_ENV=production`), then: required variables present; no `.invalid` / `placeholder` / test values; no Cloudflare Turnstile test keys; E2E, localnet and test switches off; the compliance policy fails closed and restricts US; and each mainnet RPC answers `getGenesisHash` with mainnet's genesis (read-only). It prints **names and statuses only**. Exit 1 on any missing, invalid or forbidden item.

## 1. Web app (Vercel), by service

Milestone = when it is needed: **M9** spot and baskets live; **M10** mainnet recurring through Jupiter DCA (no keeper, no program deploy; REWRITE-PLAN §7.2); **M12** Aroma Guard on mainnet when funded (keeper, Hermes, QStash); **M7** the devnet test surfaces that ship with the app.

| Service | Variable(s) | What it is | Where to get it | Recommended plan | Needed |
|---|---|---|---|---|---|
| Feature flag | `AROMA_V1_ENABLED=true` | turns v1 on; boot fails closed on any invalid v1 variable | — | — | M9 |
| Domain | `AROMA_SITE_URL` | canonical `https://` origin: HTTPS redirect, metadata, the `Site:` line of every wallet challenge, Action links | Vercel project → Domains; DNS at the registrar | — | M9 |
| Vercel | `VERCEL`, `VERCEL_ENV` (set by Vercel) | platform detection; `VERCEL=1` makes the proxy and `x-vercel-ip-country` trusted | Vercel project (Git integration on `main` only) | **Pro** (team, protection, analytics, longer functions; `maxDuration` 60 s routes) | M9 |
| Vercel | `AROMA_TRUST_PROXY` | only off Vercel, behind a proxy that overwrites forwarding and geo headers | — | leave `false` on Vercel | — |
| Vercel | `AROMA_ALLOWED_ORIGINS` | extra exact browser origins for the API | — | usually unset | optional |
| Paid RPC (primary) | `SOLANA_RPC_URL` | server mainnet RPC; genesis verified before every trade operation | Helius or Triton dashboard; API key in the URL path/query (never as `user:pass@`) | Helius **Business** or Triton dedicated (sendTransaction + simulate at trade volume; staked connections) | M9 |
| Paid RPC (browser) | `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_WS_URL` | wallet stack RPC; becomes a CSP `connect-src` entry; public in the bundle | same provider: a **separate, domain-restricted** key | origin-locked key | M9 |
| RPC failover | _(not implemented; see §3)_ | a second provider for failover | Triton if the primary is Helius, or vice versa | | M9 (design) |
| Jupiter | `JUPITER_API_KEY` | Swap API v2 `/build` and Price v3; comma-separated keys rotate. Keyless: production quotes return `TRADING_UNAVAILABLE` and most assets are unpriced | portal.jup.ag | a paid tier sized for quote volume | M9 |
| Jito | `JITO_BLOCK_ENGINE_URL`, `JITO_AUTH_UUID`, `JITO_MAX_TIP_LAMPORTS` | bundles for multi-transaction baskets; unset = such baskets refused (no partial order) | `https://mainnet.block-engine.jito.wtf/api/v1/bundles`; UUID from Jito if rate-limited | default public block engine; UUID if needed | M9 (recommended) |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate limits, trade idempotency, single-use challenge nonces (creator, terms); without it trading is unavailable | console.upstash.com → Redis, region next to Vercel's | **Pay as you go** with eviction **off** (nonces must not be evicted) | M9 |
| Neon Postgres | `DATABASE_URL` | receipts, creators, baskets, `terms_acceptances`; run `pnpm db:migrate` (now through `0004`) | console.neon.tech; pooled connection string, `sslmode=require` | **Launch** (point-in-time restore, no autosuspend on the production branch) | M9 |
| Trade HMAC | `AROMA_TRADE_SECRET`, `AROMA_TRADE_SECRET_PREVIOUS` | HMAC key for trade authorizations (32+ random chars); previous only during a rotation ([KEY-CUSTODY.md §3](./KEY-CUSTODY.md#3-aroma_trade_secret-rotation)) | generate: `openssl rand -base64 48` | — | M9 |
| Sentry | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` (build only) | errors and trade breadcrumbs (scrubbed); the auth token uploads source maps. Both DSNs must have the exact shape `https://<32-hex public key>@o<org>.ingest[.<region>].sentry.io/<project>` (`server/env.sentry.ts`); anything else stops boot | sentry.io project; the auth token is a Vercel build-time secret | **Team** | M9 |
| ~~Privy~~ | none: **removed** (REWRITE-PLAN §7.3 W1, wallet-only login). Do not create a Privy app. | | | | |
| Revalidate | `AROMA_REVALIDATE_SECRET` | bearer for `POST /api/v1/revalidate`; unset = 503 | `openssl rand -base64 48` | — | M9 (recommended) |
| Pyth | `PYTH_API_KEY` | Hermes (prices, health probe); Hermes answers 401 without a key | Pyth Pro / Hermes access | per provider | M12 (web: recommended at M9) |
| Analytics | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | consent-gated analytics | plausible.io | — | optional |
| Operator | `AROMA_OPERATOR_NAME`, `AROMA_SUPPORT_EMAIL` | legal pages' contact block | owner | — | M9 |
| Beta gate (Phase A) | `AROMA_BETA_GATE`, `AROMA_BETA_WALLETS` | private-beta access ([BETA-ACCESS.md](./BETA-ACCESS.md)): `on` for `beta.<domain>`, `off` at Phase B; optional wallet allowlist | — | — | Phase A |
| Trade caps (Phase A) | `AROMA_MAX_TRADE_USDC_RAW`, `AROMA_MAX_DAILY_USDC_RAW` | per-trade and per-wallet daily caps in raw USDC units ([TRADE-CAPS.md](./TRADE-CAPS.md)); **required in production**, 0 refused | — | — | Phase A |
| Compliance | `AROMA_COMPLIANCE_*`, `AROMA_TERMS_VERSION` | jurisdiction policy overrides ([COMPLIANCE.md §2](./COMPLIANCE.md#2-configuration-not-code)); leave unset for the defaults; never `MISSING_COUNTRY=allow` | counsel's final list | — | M9 |
| Turnstile | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | the devnet faucet's human check; test keys refused in production | Cloudflare → Turnstile, hostname = the domain | free | M7 (devnet surface) |
| Devnet surface | `AROMA_RECURRING_RPC_URL`, `NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL`, `AROMA_V1_INVEST_CLUSTER=devnet`, `AROMA_V1_FAUCET_KEYPAIR`, `AROMA_V1_FAUCET_DAILY_CLAIMS` | `/v1/invest` on devnet and its faucet (devnet-only key, never the deployer) | devnet RPC (paid devnet endpoint recommended); faucet key per KEY-CUSTODY | — | M7 |

**Must be unset in production** (`check:prod-env` and the boot schema refuse them): `AROMA_V1_ALLOW_TEST_SWITCHES`, `AROMA_V1_TEST_FORK_GENESIS`, `AROMA_V1_TEST_JUPITER_URL`, `AROMA_V1_SIMULATE_UPSTREAM_OUTAGE`, `NEXT_PUBLIC_AROMA_E2E_WALLET=true`, `NEXT_PUBLIC_AROMA_LOCALNET=true`, `AROMA_V1_LOCALNET_*`, `AROMA_LOCAL_NEON_WS_PROXY`, `AROMA_SKIP_ENV_CHECK`, and `AROMA_V1_INVEST_CLUSTER=localnet`.

Prototype-only variables (`AROMA_RECURRING_AUTH_SECRET`, `AROMA_FAUCET_SECRET_KEY`, `CREATOR_AUTH_SECRET`, `CREATOR_INVITE_CODES`, `BOT_KEYPAIR`) are removed with the prototype in M9; do not set them for v1.

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
| Collector | `AROMA_RECURRING_EXECUTOR_SECRET` | bearer for the collector endpoint; separate from every other secret | `openssl rand -base64 48` | | M12 |

## 3. RPC failover (design note, for M9)

Not implemented: it is not small. Every trade operation calls `mainnetRpc` (`features/trade/server/rpc.ts`) against one URL and asks that node for its genesis first (`assertMainnet`). A safe failover must:

1. take `SOLANA_RPC_FALLBACK_URL` (new, optional) next to `SOLANA_RPC_URL`, both validated like today (HTTPS, no userinfo, not devnet);
2. verify the genesis **per endpoint** (cache "verified mainnet" per URL for a few minutes) — never assume the fallback is mainnet because the primary was;
3. fail over only on transport errors, timeouts and 5xx / 429, never on a JSON-RPC error answer (a refused simulation must not be retried elsewhere and look different);
4. keep one quote on one endpoint where state matters (`getLatestBlockhash` → simulate), and for `sendTransaction` allow re-sending the **same signed bytes** to the fallback (idempotent by signature), while confirmation polling may read from either;
5. report both endpoints in `/api/v1/health` and alert when the fallback is in use;
6. the browser RPC (`NEXT_PUBLIC_SOLANA_RPC_URL`) is handled by the wallet stack and needs its own change (CSP `connect-src` for both).

Estimate: one focused session with tests (unit tests for each rule, plus the fork E2E with the primary stopped). Until then, run the primary on a provider with an SLA and keep a second provider's URL ready to swap in Vercel (redeploy takes a minute; `check:prod-env` verifies its genesis).

## 4. Owner order of operations (spot launch, M9)

1. Vercel Pro project on `main` only; domain; `AROMA_SITE_URL`.
2. Neon (Launch): production branch, `DATABASE_URL`, then `pnpm db:migrate` from a trusted machine.
3. Upstash Redis (eviction off).
4. Helius or Triton: two keys (server, browser origin-locked); a second provider account for failover.
5. Jupiter API key; Jito URL.
6. Sentry project, operator contact. (No Privy app: wallet-only login, REWRITE-PLAN §7.3 W1.)
7. Generate `AROMA_TRADE_SECRET` and `AROMA_REVALIDATE_SECRET` directly into Vercel's env UI (never in a file in the repo).
8. `pnpm check:prod-env` against the Vercel production env (`vercel env pull` into a file **outside** the repo, run the check, delete the file).

## 5. Phase A: `beta.<domain>` (private beta)

A **separate Vercel project** for `beta.<domain>`, built from the merged tip (needs P6), with its own env. The prototype stays on the main domain. Validate it with `pnpm check:prod-env --profile beta --env-file <file outside the repo>`: the production profile, plus the beta gate set to `on` explicitly, both caps set (above $50 / $200 warns), **no browser-visible variable v1 does not read** (the prototype's `NEXT_PUBLIC_PRIVY_APP_ID` is refused: v1 is wallet-only, W1), `AROMA_SITE_URL` on a `beta.` host (warning), and each mainnet RPC's genesis (read-only `getGenesisHash`).

Every variable the owner sets for `beta.<domain>`:

| Service | Variable(s) | Value / where | Required |
|---|---|---|---|
| Feature flag | `AROMA_V1_ENABLED` | `true` | yes |
| Domain | `AROMA_SITE_URL` | `https://beta.<domain>` | yes |
| Mainnet RPC (server) | `SOLANA_RPC_URL` | paid Helius or Triton key (path/query, never `user:pass@`) | yes |
| Mainnet RPC (browser) | `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_WS_URL` | a separate, origin-locked key for `beta.<domain>` | yes (WS optional) |
| Neon | `DATABASE_URL` | pooled, `sslmode=require`; then `pnpm db:migrate` (through `0006_trade_caps`) | yes |
| Upstash Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | eviction **off** (single-use nonces) | yes |
| Trade HMAC | `AROMA_TRADE_SECRET` | `openssl rand -base64 48`, straight into Vercel | yes |
| Jupiter | `JUPITER_API_KEY` | portal.jup.ag (keyless → `TRADING_UNAVAILABLE`) | yes |
| Beta gate | `AROMA_BETA_GATE`, `AROMA_BETA_WALLETS` | `on`; allowlist optional | gate yes |
| Caps | `AROMA_MAX_TRADE_USDC_RAW`, `AROMA_MAX_DAILY_USDC_RAW` | `50000000`, `200000000` | yes |
| Sentry | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `SENTRY_AUTH_TOKEN` (build) | the project's DSN (`https://<key>@o<org>.ingest[.<region>].sentry.io/<project>`), environment `beta` | DSNs yes |
| Turnstile | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | hostname `beta.<domain>`; never Cloudflare's test keys | recommended (devnet faucet) |
| Alerts | Sentry alert rules (web errors, `quote.refused`/`submit.refused` spikes) to the owner's channel; `KEEPER_ALERT_WEBHOOK_URL` on the **devnet** keeper host | Slack or Discord incoming webhook | recommended |
| Devnet surface | `AROMA_RECURRING_RPC_URL`, `NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL`, `AROMA_V1_INVEST_CLUSTER=devnet`, `AROMA_V1_FAUCET_KEYPAIR`, `AROMA_V1_FAUCET_DAILY_CLAIMS` | as §1 (devnet-only key, never the deployer) | for `/v1/invest` |
| Recommended | `JITO_BLOCK_ENGINE_URL`, `AROMA_REVALIDATE_SECRET`, `PYTH_API_KEY`, `AROMA_OPERATOR_NAME`, `AROMA_SUPPORT_EMAIL`, `AROMA_COMPLIANCE_*` (counsel's list) | as §1 | — |

**Must be unset on the beta** (in addition to the production list above): `NEXT_PUBLIC_PRIVY_APP_ID` and any other prototype-only variable (`AROMA_RECURRING_AUTH_SECRET`, `AROMA_FAUCET_SECRET_KEY`, `CREATOR_AUTH_SECRET`, `CREATOR_INVITE_CODES`, `BOT_KEYPAIR`). The owner's checklist, in order: [BETA-RUNBOOK.md](./BETA-RUNBOOK.md).

