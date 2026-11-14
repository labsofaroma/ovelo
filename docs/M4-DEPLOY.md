# M4 deploy checklist: wallet + spot trading

_Written for the `m4-wallet-trading` branch. Nothing here has been deployed. Every item below is something an operator must do or check; none of it can be verified from the repository alone._

Real mainnet trading was **not** exercised in M4. Every buy test ran on a local fork or against mocks (see "Not verified on real mainnet" at the end).

## 1. Required environment (v1 on)

Set these in the deployment environment (never in git). `pnpm build:web` and boot validation fail with the variable **names** if a required one is missing or malformed.

| Variable | Required | What it is | Notes |
|---|---|---|---|
| `AROMA_V1_ENABLED` | yes (`true`) | turns v1 on | builds and boots fail closed on any invalid v1 variable |
| `SOLANA_RPC_URL` | yes | server mainnet RPC (HTTPS, no credentials in the URL) | genesis is verified on every trade operation; a devnet URL is refused |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | recommended | browser RPC for the wallet stack | the wallet refuses an RPC that is not mainnet; it also becomes a `connect-src` entry |
| `JUPITER_API_KEY` | **yes for production** | Jupiter Swap API v2 `/build` and Price v3 | comma-separated keys rotate. Without a key, production quotes return `TRADING_UNAVAILABLE`, and the keyless catalog is rate-limited (M3 finding 4). `/api/v1/health` reports `jupiter: degraded` when keyless |
| `AROMA_TRADE_SECRET` | yes | HMAC key for trade authorizations (32+ random characters) | see rotation below |
| `AROMA_TRADE_SECRET_PREVIOUS` | during a rotation only | the previous trade key | must differ from the current key |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | yes | rate limits (read 120/min, write 20/min, trade 10/min per client IP) and trade idempotency | without Redis, v1 trading is unavailable and the limiter fails closed (by design) |
| `DATABASE_URL` | yes | Neon Postgres; `receipts` rows | run `pnpm db:migrate` first (the M0 migrations; M4 adds none) |
| `JITO_BLOCK_ENGINE_URL` | for multi-transaction baskets | e.g. `https://mainnet.block-engine.jito.wtf/api/v1/bundles` | unset: a basket that needs more than one transaction is refused (`BUNDLE_UNAVAILABLE`, no partial order). Single-transaction orders are unaffected |
| `JITO_AUTH_UUID` | optional | Jito auth header | |
| `JITO_MAX_TIP_LAMPORTS` | optional | tip cap, 1,000 to 100,000 | default 100,000 |
| `NEXT_PUBLIC_PRIVY_APP_ID` | optional | embedded (email) wallets | **build-time**: rebuild after changing it. Enable Solana embedded wallets in the Privy dashboard |
| `PRIVY_APP_SECRET` | optional | server-side Privy secret | not used by M4 code; kept for M5 |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT` | recommended | errors and trade breadcrumbs | events are scrubbed; trade breadcrumbs carry fingerprints, not wallets or signatures |
| `SENTRY_AUTH_TOKEN` | CI only | source-map upload | |
| `AROMA_SITE_URL` | yes in production | canonical HTTPS origin | HTTPS redirects and `metadataBase` use it |
| `AROMA_TRUST_PROXY` | behind a non-Vercel proxy only | trust `x-forwarded-*` | Vercel is detected automatically |
| `AROMA_ALLOWED_ORIGINS` | optional | extra browser origins for the API | exact origins, no wildcards |

**Must NOT be set in production** (validation rejects them when `VERCEL_ENV=production`): `AROMA_V1_ALLOW_TEST_SWITCHES`, `AROMA_V1_TEST_FORK_GENESIS`, `AROMA_V1_TEST_JUPITER_URL`, `NEXT_PUBLIC_AROMA_E2E_WALLET=true`. On a self-hosted production (not Vercel), the operator must make sure they are unset; test switches also stay off under `NODE_ENV=production` unless `AROMA_V1_ALLOW_TEST_SWITCHES=true`.

## 2. Rotating `AROMA_TRADE_SECRET`

Authorizations carry a key id (`at1.<kid>.<payload>.<mac>`), and quotes live 60 seconds.

1. Move the current value to `AROMA_TRADE_SECRET_PREVIOUS`, and put a new 32+ character random value in `AROMA_TRADE_SECRET`. Deploy.
2. New quotes are signed with the new key, and in-flight quotes signed with the old key still verify.
3. After a few minutes (one quote lifetime plus the deploy rollout), remove `AROMA_TRADE_SECRET_PREVIOUS` and deploy again. Old quotes then fail with `AUTHORIZATION_INVALID`.

If the secret leaks, skip the overlap: set a new key without `_PREVIOUS`. In-flight quotes fail closed, and users request a new quote.

## 3. Before switching traffic

- [ ] `pnpm build:web` passes in the deploy environment. The client-secret scan runs at the end of it and must print `check-client-secrets: OK … E2E markers forbidden`.
- [ ] `GET /api/v1/health` shows `rpc`, `redis`, `db`, `jupiter` and `pyth` as `ok` (`jupiter: degraded` means no API key).
- [ ] A response from `/v1/markets` has one `Content-Security-Policy` with a `nonce-…` and `'strict-dynamic'`, no `'unsafe-inline'` in `script-src`, an explicit `connect-src`, and one `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- [ ] HSTS `preload` is a commitment for the whole registrable domain and its subdomains. Confirm every subdomain serves HTTPS before submitting the domain to the preload list.
- [ ] Repeat requests to `POST /api/v1/trade/quote` from one IP get `429` with `Retry-After` after 10 per minute (the Upstash path; M4 proved only the local fallback).
- [ ] The wallet picker lists installed Wallet Standard wallets. Privy email login works if configured.
- [ ] With a **small** amount and an operator's own wallet: one stock buy and one basket buy on mainnet, then check the receipts rows and `/v1/portfolio` (see section 4).

## 4. Not verified on real mainnet

M4 never signed or sent a transaction with real funds. These were proven only on a local fork (solana-test-validator with accounts cloned from mainnet), or with mocks, and remain **not verified** on mainnet:

- A real wallet extension (Phantom, Solflare, Backpack) and a Privy embedded wallet signing a v1 quote. E2E used a test-only signer bridge.
- A real `sendTransaction` landing on mainnet, and confirmation tracking against real block times.
- Jito bundle submission and status. No bundle ran in E2E (both E2E orders fit in one transaction, and Jito is not configured).
- V1 transactions. The fork has no V1 feature account, so every E2E order was V0 with lookup tables.
- Upstash rate limiting and Redis idempotency. E2E and unit tests used the local fallback limiter and in-memory stores.
- Receipts in Neon. They were tested against PGlite with the real migrations; E2E used in-memory receipts.
- Sentry breadcrumbs reaching a real Sentry project.
- Lighthouse on a deployed host. The scores in the M4 status were measured on a local `next start`.

## 5. M5: creators and Solana Actions

_Added on `m5-creators` (M5b). Nothing here has been deployed either. Every buy test ran on the local fork; no transaction with real funds was signed or sent._

### 5.1 Environment

M5 adds **no new required variable**. It uses the M4 ones:

| Variable | Used by M5 for | Notes |
|---|---|---|
| `DATABASE_URL` | creators, invites, baskets, `basket_versions`, receipts, creator stats | run `pnpm db:migrate` first: **migration `0002_basket_versions`** is new (insert-only history; triggers refuse UPDATE/DELETE/TRUNCATE) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | single-use creator challenges (5-minute nonces, `GETDEL`), the new `creator` rate-limit bucket | without Redis, challenges cannot be issued (503); nothing falls back to memory outside a local-fork E2E |
| `AROMA_SITE_URL` | the `Site:` line of every creator challenge, and the links inside Solana Actions | set it to the canonical HTTPS origin, or wallet prompts show the host the request came in on |
| `AROMA_TRADE_SECRET` | the Action's `links.next` callback is bound by the same HMAC authorization as a trade | rotation (section 2) applies; a callback more than 15 minutes after its quote expired is refused |
| `NEXT_PUBLIC_PRIVY_APP_ID` | optional; Privy embedded wallets sign creator challenges with `useSignMessage` | build-time |

**Must NOT be set in production:** `AROMA_LOCAL_NEON_WS_PROXY` (local Docker Postgres only; it is ignored unless `DATABASE_URL` is loopback and `VERCEL_ENV` is not `production`, but keep it out of every deployed environment). `CREATOR_AUTH_SECRET` and `CREATOR_INVITE_CODES` are prototype-only; v1 needs neither (remove at M7).

### 5.2 Rate limits (middleware)

| Bucket | Paths | Limit per client IP |
|---|---|---|
| `creator` (new) | `POST /api/v1/creators/challenge`, `POST /api/v1/creators/invites/redeem` | 10 / min |
| `write` | other creator mutations (publish/save, archive) | 20 / min |
| `trade` | `/api/v1/trade/*` and **every non-GET `/api/v1/actions/*`** (quote, build and simulate; the confirm callback reads mainnet) | 10 / min |

Behind a proxy other than Vercel, `AROMA_TRUST_PROXY=true` is required for per-client buckets; otherwise every client shares one bucket (M4 behaviour, by design: forwarding headers are not trusted).

### 5.3 Creator onboarding (operator)

1. Create an invite with the admin CLI, from `apps/web` with `DATABASE_URL` in the environment: `pnpm exec tsx scripts/create-invite.ts --days 7` (single-use by default; `--uses N` up to 100; expiry 1–90 days, always). The code is printed **once**; only its SHA-256 is stored.
2. Send the code to the creator over a private channel. They open `/v1/basket/new`, connect a wallet that can **sign messages** (Wallet Standard `solana:signMessage`, a legacy adapter's `signMessage`, or a Privy embedded wallet), enter the code and a display name, and sign twice (redeem, then publish). Nothing is a transaction.
3. A used, expired or unknown code gets one public message; the reason is in the logs (`invite:used`, `invite:expired`, …).

### 5.4 Solana Actions

- v1 Actions: `GET/POST /api/v1/actions/baskets/:id` (curated slug or published creator basket UUID) and `POST /api/v1/actions/baskets/:id/confirm` (the `links.next` callback that records the receipt after reading the transaction back from mainnet). All return 404 while `AROMA_V1_ENABLED` is off.
- `actions.json` adds `{ "pathPattern": "/v1/basket/*", "apiPath": "/api/v1/actions/baskets/*" }` only while the flag is on; the prototype rules are unchanged.
- A basket that needs more than one transaction is refused by the Action with a link to buy it on the site (no partial order; Blink clients sign one transaction).
- Purchases through a Blink client that never calls `links.next` are **not** counted in creator stats (never guessed).
- [ ] Check with a Blink client (for example the Dialect inspector) against a preview URL: metadata renders, the POST returns a transaction for your wallet, and **do not sign it** unless you intend a small real purchase with your own wallet.

**M7 path switch.** At cutover: (1) move `app/api/v1/actions/baskets/[id]` to `app/api/actions/baskets/[id]` and delete the prototype `app/api/actions/buy-baskets` and `baskets` routes; (2) in `features/baskets/actions-json.ts` replace the prototype rules with `{ pathPattern: "/basket/*", apiPath: "/api/actions/baskets/*" }` and drop the `/v1` rule; (3) in `middleware.ts` drop the `v1Action` special case (the `/api/actions/` prefix covers it) and in `server/request-guard.ts` the `/api/v1/actions/` trade path; (4) `actionHref` in `features/baskets/actions.ts` loses `/v1`. Old Blink URLs under `/v1/basket/*` then 404; announce the new links before the switch.

### 5.5 Before switching traffic (additions)

- [ ] `pnpm db:migrate` applied `0002_basket_versions` (check `select count(*) from basket_versions` works, and an `UPDATE basket_versions …` is refused).
- [ ] One invite created, redeemed and used to publish a basket on the preview, with an operator's own wallet; the basket appears in `/v1/creators` and at `/v1/basket/<id>`.
- [ ] A response from `/v1/basket/new` carries the nonce CSP (same check as section 3); the builder hydrates (typing updates the preview).
- [ ] `POST /api/v1/creators/challenge` from one IP answers 429 after 10 per minute (Upstash path).

### 5.6 Not verified on real mainnet (M5)

- A real wallet extension or Privy signing a creator challenge (E2E used the test-only bridge).
- A Blink client fetching the v1 Action, signing and sending on mainnet, and calling the confirm callback.
- Receipts and creator stats in Neon (verified on PGlite and on local Docker Postgres through the Neon driver).
- Upstash for creator challenges and the `creator` bucket (E2E and tests used in-process stores).

## 6. M7: recurring investing on devnet (`/v1/invest`), the keeper and the faucet

Nothing below is configured or verified on a real deployment yet (see §7.5). Every value is devnet-only.

### 6.1 Web app (`apps/web`)
| Variable | Notes |
|---|---|
| `AROMA_V1_INVEST_CLUSTER` | `devnet` (default). `localnet` is for the local E2E only; refused in production. |
| `AROMA_RECURRING_RPC_URL` | server devnet RPC; genesis-checked per client (devnet's genesis or refused) |
| `NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL` | browser devnet RPC (the wallet must report devnet's genesis); also added to `connect-src` |
| `AROMA_V1_FAUCET_KEYPAIR` | the devnet-only faucet key (64-byte JSON array) that holds the **test USD mint authority**; created by `init-devnet` in `packages/contracts/.keys/devnet-faucet.json`. Never the deployer. |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile (owner creates the widget). Production refuses Cloudflare's test secrets. |
| `AROMA_V1_FAUCET_DAILY_CLAIMS` | global claims per UTC day (default 200) |
| `UPSTASH_REDIS_REST_URL/TOKEN`, `DATABASE_URL`, `AROMA_TRADE_SECRET` | as in §1 (idempotency, faucet limits; plans_index and receipts; plan authorizations use a key derived from the trade secret) |

The page and every `/api/v1/plans*` and `/api/v1/faucet` route answer "not available on devnet yet" while `V1_DEPLOYMENTS.devnet` (`packages/guard/src/v1/deployments.ts`) is `null`; fill it from the owner's deploy output (M6-DEVNET-DEPLOY.md).

### 6.2 Keeper (`apps/keeper`, a separate Node service)
| Variable | Notes |
|---|---|
| `KEEPER_KEYPAIR` | the devnet keeper key (`.keys/devnet-keeper.json`), = `config.keeper_authority`. Devnet only; refused on any other genesis. |
| `KEEPER_RPC_URL` | HTTPS devnet RPC |
| `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | both required (rotation) |
| `KEEPER_PUBLIC_URL` | the `/run` URL QStash calls (signature `sub` check) |
| `HERMES_URL`, `PYTH_API_KEY` | Hermes needs a key (401 without one) |
| `UPSTASH_REDIS_REST_URL/TOKEN`, `DATABASE_URL` | the same Redis and Postgres as the web app |
| `KEEPER_ALERT_WEBHOOK_URL`, `KEEPER_ALERT_FORMAT` | Slack (default) or Discord webhook |
| `KEEPER_MIN_SOL_LAMPORTS`, `KEEPER_MAX_PLANS_PER_RUN`, `KEEPER_MAX_ATTEMPTS`, `KEEPER_DLQ_ALERT_THRESHOLD`, `KEEPER_PRIORITY_MICROLAMPORTS`, `KEEPER_PORT` | limits with safe defaults |

Start: `pnpm --filter @aroma/keeper start` (validates env and the RPC genesis before listening). Operations: [keeper-operations.md](./keeper-operations.md).

### 6.3 QStash schedule (owner)
Create a schedule that POSTs `{}` to `KEEPER_PUBLIC_URL` every 1–5 minutes; copy its current and next signing keys into the keeper env.

### 6.4 Before switching traffic (additions)
- Faucet key funded with devnet SOL and holding the test USD mint authority (`devnet:audit` shows `testUsdAuthorityIsFaucet`).
- Keeper key funded with devnet SOL; `config.keeper_authority` equals it.
- One manual signed run (`pnpm --filter @aroma/keeper cli run <url>`) returns 200 and a report.

### 6.5 Not verified on real devnet (M7)
The devnet program deploy (owner), a Hermes API key, a QStash schedule, Turnstile keys, the alert webhook, Upstash and Neon for devnet. Everything was verified on a local validator only (REWRITE-PLAN, M7 status).
