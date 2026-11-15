# Architecture

Ovelo v1 as built (M9, Phase B; M11 launch features on branch `m11-launch`). Own tokenized stocks on Solana from your own wallet: research, buy single names or themed baskets (mainnet spot through Jupiter), practise on paper, and try recurring plans on devnet. The server prepares and checks transactions; **wallets sign them**; no user key ever reaches the server.

## Repository

| Path | What |
|---|---|
| `apps/web` | Next.js 15 App Router (React 19, TypeScript strict with `noUncheckedIndexedAccess`). Pages in two root route groups, `(app)` and `(marketing)`; the versioned API under `/api/v1`; `middleware.ts` |
| `apps/web/features/<feature>` | All product code: `markets`, `stock`, `baskets`, `trade`, `portfolio`, `watchlist`, `creators`, `invest`, `compliance`, `beta`, `caps`, `wallet`, `account`, `marketing`, `shared`, and (M11) `notifications`, `onboarding`. Server modules in `server/` or `server.ts` (`import "server-only"`) |
| `apps/web/server` | Server infrastructure: validated env (`env.schema.ts`), RPC (`rpc.ts`), auth tokens (`auth/`), Postgres (`db/`), Redis, rate limits, CSP, errors, telemetry, the 410 rule (`gone.ts`), the trading switch |
| `apps/web/lib/sdk` | Chain, market and basket helpers: catalog and sources, research, Jupiter, Pyth, basket math, paper trading |
| `apps/keeper` | The recurring-plan keeper, triggered by QStash ([keeper-operations.md](./keeper-operations.md)); devnet today, mainnet at M12 ([keeper-mainnet.md](./keeper-mainnet.md)) |
| `packages/contracts` | Ovelo Guard v1, the Anchor program for recurring plans, with its LiteSVM suite ([ovelo-guard-v1.md](./ovelo-guard-v1.md), [CONTRACT-V1-SPEC.md](./CONTRACT-V1-SPEC.md)). Devnet only until M12 |
| `packages/guard` | `@ovelo/guard`: the Codama-generated client, builders and decoders for Ovelo Guard v1, plus the Pyth and Jupiter pieces the app and the keeper share |
| `packages/ui` | `@ovelo/ui`: `tokens.css` (design tokens), Tailwind v4 theme, primitives, `Brand`, `AssetAvatar` |
| `packages/config` | Shared tsconfig, ESLint, Prettier and Vitest presets |

## Pages

All server-rendered (RSC) with small client islands; every page is dynamic because each response carries a fresh CSP nonce. Market and research data come from the Next data cache (tagged, refreshed by `POST /api/v1/revalidate`), never the disk.

`/` landing · `/markets` · `/stock/[symbol]` · `/baskets` · `/basket/[id]` (curated slug or creator basket UUID) · `/basket/new` (builder) · `/watchlist` · `/portfolio` (activity at `#activity`, P&L) · `/get-started` · `/creators` · `/creators/dashboard` · `/invest` (devnet) · `/settings` · `/privacy` · `/terms` · `/restricted`. Every page says which mode it shows: **mainnet spot purchase**, **devnet recurring test** or **paper practice** ([PRODUCT.md](../PRODUCT.md)). Old URLs (`/v1/*`, `/landing`, `/app`, `/sip`, `/basket/builder`, `/orders`) redirect 308 (`apps/web/redirects.mjs`); the removed prototype APIs answer 410 `GONE`.

## A request, end to end

1. **Middleware** (`apps/web/middleware.ts`, Node.js runtime), on every route:
   - Phase H, self-host only: the **origin lock** first. In `cloudflare` proxy mode, a request without the edge's `x-ovelo-origin` secret gets 403 `ORIGIN_REFUSED`; the header is then stripped;
   - HTTPS redirect to `OVELO_SITE_URL` in production; HSTS (`includeSubDomains; preload`) on production deployments only;
   - removed prototype APIs → 410 `{ code: "GONE", message }`, before anything else;
   - a per-request nonce CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, explicit `connect-src`, `frame-ancestors 'none'`);
   - for APIs: origin allowlist, JSON-only mutations, body caps, Upstash rate limits per bucket (read, write, trade, creator, faucet);
   - the trading gates at the edge, in order: **emergency stop** (`OVELO_TRADING=off`) → **location** (geo-block) → **beta access** (while the private beta is on).
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
- **Beta access** ([launch/BETA-ACCESS.md](./launch/BETA-ACCESS.md)): wallet allowlist and single-use invites while `OVELO_BETA_GATE=on`; switched off for the public launch.
- **Caps** ([launch/TRADE-CAPS.md](./launch/TRADE-CAPS.md)): per-trade and per-wallet-per-day maximums in raw USDC (`bigint`), checked at quote, reserved atomically at submit.
- **Emergency stop:** `OVELO_TRADING=off` → 503 on every trading entry point; reads, receipts and plan closes stay open.

## Recurring plans (devnet)

`/invest` creates and closes Ovelo Guard v1 plans on **devnet** with test tokens of no value (`features/invest`; prepare → wallet signs → submit). The keeper (`apps/keeper`) executes due installments: QStash calls `POST /run` (signature verified), it takes a lease per plan and period, posts a fresh Pyth price, executes oldest period first, records skipped periods, retries with backoff, keeps a dead-letter list and alerts a webhook. Mainnet recurring is not offered: `/invest` shows the devnet plans under a "Mainnet recurring: coming" notice. M10 took **Path B** (owner, 2026-11-15): Jupiter's on-chain Recurring API rejects every xStock (Token-2022), and its successor holds deposits in a Jupiter-controlled custodial vault with off-chain orders ([launch/DCA-SPIKE.md](./launch/DCA-SPIKE.md)). **M12** (Ovelo Guard on mainnet, when funded) is the mainnet recurring path.

## Launch features (M11)

- **Notifications outbox** (`features/notifications`, migration `0007`):
  - `notification_events` holds one row per fact, with a deterministic id. Trade and creator-buy events come from a scan of Ovelo's receipts (the trade path stays frozen). Devnet round events are written by the keeper in the same step (`apps/keeper/src/notify.ts`), only for owners with an active subscription.
  - The worker (`POST /api/v1/notifications/deliver`, bearer secret, QStash every minute) fans each event out into one `notifications` row per active channel (unique on event and channel). It then claims due rows with `SKIP LOCKED` and a 60 s lease, sends, and settles them as sent, retried (exponential back-off) or dead (6 attempts, or a permanent failure).
  - Delivery is at-least-once; push dedupes on the receiver (`tag` = event id).
  - Channels sit behind `NotificationChannel`, with local fakes: web push (RFC 8291/8292 on `node:crypto`, endpoints restricted to known push services) and Telegram (Bot API over `fetch`, verified by a one-time `/start` code). Email is off.
  - Opt-in is wallet-signed per channel (`server/wallet-challenge.ts`); reads and changes use a 15-minute `ws1` session (`server/wallet-session.ts`). Unsubscribe and "delete all" are hard deletes.
- **P&L** (`features/portfolio/pnl`): confirmed receipts plus the exact fill of each confirmed transaction (the token-balance change, read once over read-only RPC and cached in Redis), replayed as average cost in `bigint` against the balance on chain now. A holding larger than Ovelo bought is "cost basis unknown"; a smaller one left at average cost. Views per holding, per basket and in totals over what is known. The CSV is served to the signed-in wallet only (`ws1` portfolio session).
- **Onboarding funnel** (`features/onboarding`, `/get-started`): wallet → real SOL and USDC balances against the SOL the suggested basket needs → a catalog basket chosen by a stated rule, into the trade ticket with the usual gates. Four events, consent-gated, with no wallet address (`features/shared/analytics.ts`).
- **Creator dashboard** (`/creators/dashboard`, `GET /api/v1/creators/dashboard`, `ws1` creator session): the wallet's own baskets only (403 otherwise), with usage from confirmed receipts and the version history. The Blink share comes from `purchase_channels` (migration `0008`, written by the Action confirm callback).
- **Fee-share ledger** (`features/creators/fee-share.ts`, migration `0009`): accounting only. One row per confirmed creator-basket order, with the fee at 0; boot refuses a non-zero platform fee. No payout exists.

## Data stores

| Store | What |
|---|---|
| Postgres (Neon, Drizzle; migrations through `0009`) | `creators`, `invites`, `baskets`, `basket_allocations`, `basket_versions` (insert-only), `receipts`, `plans_index`, `terms_acceptances`, `beta_invites`, `beta_access`, `trade_cap_days`, `trade_cap_reservations`, M11's `notification_subscriptions`, `notification_events`, `notifications` (deliveries), `purchase_channels`, `fee_share_ledger` (plus `portfolio_snapshots`, unused) |
| Upstash Redis (eviction off) | rate limits, trade idempotency and records, single-use challenge nonces (creators, terms, beta, M11 wallet challenges), keeper leases and dead letters, M11 fill cache (30 days) |
| Next data cache | market snapshots and research, tagged and revalidated; an outage is never cached |
| Browser | theme, consent, watchlist (mints), paper account and drafts, the onboarding funnel's first-time flags (after consent only), the push service worker (`/notify-sw.js`); session tokens stay in memory |

## Observability

pino JSON logs with redaction (wallets and signatures become fingerprints), Sentry (errors, one breadcrumb per trade stage, events for alerts such as `rpc.wrong_cluster`), and `GET /api/v1/health`: RPC primary and fallback with genesis and slot age, Redis, Postgres, Jupiter and Pyth. Since Phase H the public body has statuses only (`ok`, `degraded`, `down`, `skipped`) plus the RPC failover facts; the full report is logged. Liveness for containers is `GET /api/v1/health/live`.

## Deployment (two supported platforms)

Who the client is (IP, country, scheme, host) comes from one module, `server/proxy.ts`. Which platform and environment this is, and whether production rules apply, comes from one module, `server/platform.ts`. Each fails closed when its answer is missing or inconsistent.

**Vercel** (unchanged): Git integration on `main`; `VERCEL_ENV` gives the deploy environment; proxy mode `vercel` (`X-Real-IP`, `x-vercel-ip-country`); Instant Rollback.

**Hostinger VPS behind Cloudflare** (Phase H; [SELF-HOST.md](./launch/SELF-HOST.md), [HOSTINGER-RUNBOOK.md](./launch/HOSTINGER-RUNBOOK.md)):

```
User ──HTTPS──▶ Cloudflare edge: DNS, TLS, WAF (+ trading geo backup), rate limits,
                cache rules (HTML and /api bypassed), Transform Rule sets x-ovelo-origin
                    │  Cloudflare Tunnel (outbound-only from the VPS; no inbound 80/443)
                    ▼
Hostinger VPS (Ubuntu 24.04; ufw + Hostinger firewall: SSH over Tailscale only)
  docker compose (deploy/hostinger/docker-compose.yml):
    cloudflared ──[internal network "edge"]──▶ app :3000 (not published on the host)
      app: image by digest (cosign-verified), read-only root, tmpfs /tmp, cache volume,
           UID 10001, cap_drop ALL, no-new-privileges, 1 GiB / 1.5 CPU, 65 s drain,
           OVELO_PLATFORM=selfhost, OVELO_PROXY_MODE=cloudflare (CF-Connecting-IP, CF-IPCountry)
    app ──[network "egress"]──▶ Neon, Upstash (Redis, QStash), RPC primary and fallback,
                                 Jupiter, Pyth Hermes, Jito, Sentry, push, Telegram
CI (.github/workflows/image.yml): test gate → build → Trivy → SBOM → cosign sign → attest
  (no deploy job: the owner runs deploy.sh <digest> on the VPS; the VPS pulls by digest)
```

One app instance: the page, data and image caches are local to it.

## Further reading

[REWRITE-PLAN.md](./REWRITE-PLAN.md) (milestones and status), [AUDIT.md](./AUDIT.md), [ovelo-guard-v1.md](./ovelo-guard-v1.md), [keeper-operations.md](./keeper-operations.md), and the launch runbooks in [launch/](./launch): [CUTOVER-RUNBOOK.md](./launch/CUTOVER-RUNBOOK.md), [PRODUCTION-ENV.md](./launch/PRODUCTION-ENV.md), [KEY-CUSTODY.md](./launch/KEY-CUSTODY.md), [MERGE-PLAN.md](./launch/MERGE-PLAN.md), and for self-host [SELF-HOST.md](./launch/SELF-HOST.md) and [HOSTINGER-RUNBOOK.md](./launch/HOSTINGER-RUNBOOK.md).
