# Architecture

Aroma v1 as built (M9, Phase B). Own tokenized stocks on Solana from your own wallet: research, buy single names or themed baskets (mainnet spot through Jupiter), practise on paper, and try recurring plans on devnet. The server prepares and checks transactions; **wallets sign them**; no user key ever reaches the server.

## Repository

| Path | What |
|---|---|
| `apps/web` | Next.js 15 App Router (React 19, TypeScript strict with `noUncheckedIndexedAccess`). Pages in two root route groups, `(app)` and `(marketing)`; the versioned API under `/api/v1`; `middleware.ts` |
| `apps/web/features/<feature>` | All product code: `markets`, `stock`, `baskets`, `trade`, `portfolio`, `watchlist`, `creators`, `invest`, `compliance`, `beta`, `caps`, `wallet`, `account`, `marketing`, `shared`. Server modules in `server/` or `server.ts` (`import "server-only"`) |
| `apps/web/server` | Server infrastructure: validated env (`env.schema.ts`), RPC (`rpc.ts`), auth tokens (`auth/`), Postgres (`db/`), Redis, rate limits, CSP, errors, telemetry, the 410 rule (`gone.ts`), the trading switch |
| `apps/web/lib/sdk` | Chain, market and basket helpers: catalog and sources, research, Jupiter, Pyth, basket math, paper trading |
| `apps/keeper` | The recurring-plan keeper, triggered by QStash ([keeper-operations.md](./keeper-operations.md)); devnet today, mainnet at M12 ([keeper-mainnet.md](./keeper-mainnet.md)) |
| `packages/contracts` | Aroma Guard v1, the Anchor program for recurring plans, with its LiteSVM suite ([aroma-guard-v1.md](./aroma-guard-v1.md), [CONTRACT-V1-SPEC.md](./CONTRACT-V1-SPEC.md)). Devnet only until M12 |
| `packages/guard` | `@aroma/guard`: the Codama-generated client, builders and decoders for Aroma Guard v1, plus the Pyth and Jupiter pieces the app and the keeper share |
| `packages/ui` | `@aroma/ui`: `tokens.css` (design tokens), Tailwind v4 theme, primitives, `Brand`, `AssetAvatar` |
| `packages/config` | Shared tsconfig, ESLint, Prettier and Vitest presets |

## Pages

All server-rendered (RSC) with small client islands; every page is dynamic because each response carries a fresh CSP nonce. Market and research data come from the Next data cache (tagged, refreshed by `POST /api/v1/revalidate`), never the disk.

`/` landing · `/markets` · `/stock/[symbol]` · `/baskets` · `/basket/[id]` (curated slug or creator basket UUID) · `/basket/new` (builder) · `/watchlist` · `/portfolio` (activity at `#activity`) · `/creators` · `/invest` (devnet) · `/settings` · `/privacy` · `/terms` · `/restricted`. Every page says which mode it shows: **mainnet spot purchase**, **devnet recurring test** or **paper practice** ([PRODUCT.md](../PRODUCT.md)). Old URLs (`/v1/*`, `/landing`, `/app`, `/sip`, `/basket/builder`, `/orders`) redirect 308 (`apps/web/redirects.mjs`); the removed prototype APIs answer 410 `GONE`.

## A request, end to end

1. **Middleware** (`apps/web/middleware.ts`, Node.js runtime), on every route:
   - HTTPS redirect to `AROMA_SITE_URL` in production; HSTS (`includeSubDomains; preload`) on production deployments only;
   - removed prototype APIs → 410 `{ code: "GONE", message }`, before anything else;
   - a per-request nonce CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, explicit `connect-src`, `frame-ancestors 'none'`);
   - for APIs: origin allowlist, JSON-only mutations, body caps, Upstash rate limits per bucket (read, write, trade, creator, faucet);
   - the trading gates at the edge, in order: **emergency stop** (`AROMA_TRADING=off`) → **location** (geo-block) → **beta access** (while the private beta is on).
2. **Route handler** (`app/api/v1/**/route.ts`): thin. Parse with zod, call a feature service, return the typed result or `mapError` → `{ code, message }` only (`server/route-contract.test.ts`). Every state-changing route needs a wallet signature, an HMAC authorization or a bearer secret.
3. **Feature service** (`features/*/server`): the logic, against `lib/sdk`, Postgres, Redis and the RPC.

The gates every route must have are pinned in `server/route-gates.test.ts` (a new route without an entry fails the test).

## The money path: a mainnet spot buy

1. **Quote** (`POST /api/v1/trade/quote`): the handler re-checks the trading switch, location, beta access and **current terms acceptance**, then the **caps** pre-check. `features/trade/server` builds the order: catalog rows only (verified, not halted), Jupiter `/build` per leg, route review against the reviewed Jupiter program schema (`packages/guard/src/jupiter`; unknown swap variants are refused), lookup tables verified, `min_out` and settlement checks, and **every transaction simulated** on mainnet before it is returned. The response carries the unsigned transactions, the reviewed figures and an HMAC **authorization** (`at1.<kid>.<payload>.<mac>`, canonical base64url only) bound to the exact bytes, the wallet and the expiry.
2. **Review and sign** (browser): the review screen shows source, route, price impact, fees, minimum received, the cap limits and the risk disclosure around the confirm control. The user's wallet signs (`features/wallet`, Wallet Standard; web3.js v1 only inside this bridge).
3. **Submit** (`POST /api/v1/trade/submit`): verify the authorization and that the signed bytes are the authorized messages; claim the request id (idempotent, never broadcast twice); reserve the **daily cap** atomically in Postgres; preflight (genesis, V1 activation, block height); send. A basket that needs several transactions goes as one **Jito bundle** or not at all.
4. **Confirm**: poll signature statuses, write receipts (pending → confirmed | failed, never back), settle the cap reservation. A transaction that provably never landed (no status within 150 block heights after its blockhash expired) is failed; anything undecidable stays unknown, never "failed".

**RPC failover** (`features/trade/server/rpc-pool.ts`, [PRODUCTION-ENV.md §3](./launch/PRODUCTION-ENV.md#3-rpc-failover-implemented-m9)): `SOLANA_RPC_URL` plus an optional `SOLANA_RPC_FALLBACK_URL`. Every endpoint proves the mainnet genesis on its own; failover only on transport errors, timeouts, 5xx and 429, never on a JSON-RPC error answer; a quote stays on one endpoint; submit re-sends the **same signed bytes** to the other endpoint only after a transport failure.

**Solana Actions / Blinks** (`/api/v1/actions/baskets/:id`, `/actions.json`): the same quote service builds a basket transaction for a Blink client; the `/confirm` callback records the receipt only after reading the transaction back from mainnet.

## Compliance, beta access and caps

- **Compliance** ([launch/COMPLIANCE.md](./launch/COMPLIANCE.md)): IP geo-blocking from the trusted platform header at every trading entry point (edge and route), terms acceptance signed by the wallet before the first quote, a risk disclosure on every review. Fails closed when the country is missing or the policy is invalid.
- **Beta access** ([launch/BETA-ACCESS.md](./launch/BETA-ACCESS.md)): wallet allowlist and single-use invites while `AROMA_BETA_GATE=on`; switched off for the public launch.
- **Caps** ([launch/TRADE-CAPS.md](./launch/TRADE-CAPS.md)): per-trade and per-wallet-per-day maximums in raw USDC (`bigint`), checked at quote, reserved atomically at submit.
- **Emergency stop:** `AROMA_TRADING=off` → 503 on every trading entry point; reads, receipts and plan closes stay open.

## Recurring plans (devnet)

`/invest` creates and closes Aroma Guard v1 plans on **devnet** with test tokens of no value (`features/invest`; prepare → wallet signs → submit). The keeper (`apps/keeper`) executes due installments: QStash calls `POST /run` (signature verified), it takes a lease per plan and period, posts a fresh Pyth price, executes oldest period first, records skipped periods, retries with backoff, keeps a dead-letter list and alerts a webhook. Mainnet recurring is not offered: `/invest` shows the devnet plans under a "Mainnet recurring: coming" notice. M10 took **Path B** (owner, 2026-11-15): Jupiter's on-chain Recurring API rejects every xStock (Token-2022), and its successor holds deposits in a Jupiter-controlled custodial vault with off-chain orders ([launch/DCA-SPIKE.md](./launch/DCA-SPIKE.md)). **M12** (Aroma Guard on mainnet, when funded) is the mainnet recurring path.

## Data stores

| Store | What |
|---|---|
| Postgres (Neon, Drizzle; migrations through `0006`) | `creators`, `invites`, `baskets`, `basket_allocations`, `basket_versions` (insert-only), `receipts`, `plans_index`, `terms_acceptances`, `beta_invites`, `beta_access`, `trade_cap_days`, `trade_cap_reservations` (plus `notifications`, `portfolio_snapshots` for later milestones) |
| Upstash Redis (eviction off) | rate limits, trade idempotency and records, single-use challenge nonces (creators, terms, beta), keeper leases and dead letters |
| Next data cache | market snapshots and research, tagged and revalidated; an outage is never cached |
| Browser | theme, consent, watchlist (mints), paper account and drafts; nothing that must survive or be shared |

## Observability

pino JSON logs with redaction (wallets and signatures become fingerprints), Sentry (errors, one breadcrumb per trade stage, events for alerts such as `rpc.wrong_cluster`), and `GET /api/v1/health` (RPC primary and fallback with genesis and slot age, Redis, Postgres, Jupiter, Pyth; facts only).

## Further reading

[REWRITE-PLAN.md](./REWRITE-PLAN.md) (milestones and status), [AUDIT.md](./AUDIT.md), [aroma-guard-v1.md](./aroma-guard-v1.md), [keeper-operations.md](./keeper-operations.md), and the launch runbooks in [launch/](./launch): [CUTOVER-RUNBOOK.md](./launch/CUTOVER-RUNBOOK.md), [PRODUCTION-ENV.md](./launch/PRODUCTION-ENV.md), [KEY-CUSTODY.md](./launch/KEY-CUSTODY.md), [MERGE-PLAN.md](./launch/MERGE-PLAN.md).
