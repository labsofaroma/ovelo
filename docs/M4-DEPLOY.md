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
