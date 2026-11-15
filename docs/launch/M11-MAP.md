# M11 map: what exists before Phase D

Inventory of branch `m11-launch` at its base `38f7706` (the `m10-recurring` tip), taken before any M11 code. Paths are relative to `apps/web/` unless they start with `apps/`, `packages/` or `docs/`. Line numbers are approximate and refer to `38f7706`.

## Baseline (Step 0)

Same numbers as the M10 / Phase C final evidence (REWRITE-PLAN, "M10 / Phase C status").

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ok |
| `pnpm typecheck --force` | ok |
| `pnpm lint --force` | 0 errors, 0 warnings |
| `pnpm format:check` | ok |
| `pnpm test --force` | web 1,644 passed / 3 skipped (199 files), guard 99, keeper 47, contracts 30, ui 173, config 2 |
| `pnpm build:web` (`.env.example` placeholders in the environment) | env check ok; `/markets` first-load JS 145 kB; `check-client-secrets: OK`, 260 files |

Local Node is 24.21.0; AGENTS.md pins 24.12.0. Without the placeholders, `build:web` stops at the env check as designed: `SOLANA_RPC_URL`, `DATABASE_URL`, `UPSTASH_REDIS_REST_*` and `OVELO_TRADE_SECRET` are required.

## 1. Notifications

**What exists**
- **Table `notifications`** (`server/db/schema.ts:240-263`, created in `migrations/0000_initial_schema.sql`).
  - Columns: `id` uuid, `wallet`, `channel`, `event` (free text), `payload` jsonb, `sent_at`, `created_at`.
  - `channel` takes `email | push | telegram` (`NOTIFICATION_CHANNELS`, CHECK `notifications_channel_valid`).
  - Index on `(wallet, created_at)`.
  - Nothing reads or writes it.
- **Migrations.** `0000`–`0006`; the last is `0006_trade_caps`. The next free number is **`0007`**, not `0008` as the Phase D prompt assumes. `server/db/schema.test.ts:55-77` pins the exact table list. New tables follow the `schema.beta.ts` / `schema.caps.ts` split, re-exported from `schema.ts`.
- **Single-use signed challenges.** These are the pattern for the opt-in.
  - `server/auth/creator.ts`: `CHALLENGE_PURPOSES` (l.29: `publish|update|delete|redeem|terms|beta`), `PURPOSE_TITLE` (l.41), `issueChallenge` (l.164: `SET creator:challenge:{nonce} NX EX 300`), `verifyChallenge` (l.233: `GETDEL`, then Ed25519).
  - The store is `redisChallengeStore` in `features/creators/http.ts:31`, with an in-memory version for the fork E2E.
  - Terms use it in `features/compliance/server/terms.ts` (`issueTermsChallenge`, `acceptTerms`, with a UNIQUE `nonce` as the second guard).
  - Note: `server/auth/**` is frozen (rule 7). A new purpose needs either an exception from the owner or a separate challenge module outside `server/auth`.
- **Body and gate helpers.**
  - `readLimitedJson` and `parse` (`server/http.ts:13`, 16 KB default), `errorResponse`, `assertSameOrigin`.
  - Route-gate table: `server/route-gates.test.ts`. Its `APIS` and `PAGES` records must match `git ls-files app/` both ways.
  - Rate limits: `server/ratelimit.ts` (Upstash, a local fallback, fails closed when Redis is required but missing). Buckets and paths are in `server/request-guard.ts` (`bucketFor`, `LIMITS`); the limiters are created in `middleware.ts`.
- **Workers.**
  - QStash is verified by hand (HS256, current then next key) in `apps/keeper/src/qstash.ts`.
  - `apps/keeper/src/handler.ts` serves `POST /run` (signed, 16 KB cap, 409 while a run is in flight) and `GET /health`.
  - `@upstash/qstash` is not installed. `QSTASH_*` is in `server/env.schema.ts:186-191`.
- **Keeper events** (`apps/keeper/src`; operator alerts only, to a Slack or Discord webhook through `alerts.ts`, with a Redis dedupe and a 20/min cap):
  - `run.ts`: `rpc_degraded`, `keeper_balance_low` (the keeper's own SOL), `dead_letter_growth`;
  - `execute.ts`: `executePlan` returns `executed | not_due | paused | lease_held | deferred | dead_lettered`, and alerts `hermes_unavailable`, `installment_failed` (pushed to the DLQ) and `installment_skipped`.
  - Installment receipts are written by `apps/keeper/src/db.ts:143` (`insertInstallment`).
  - `plans_index.owner` (`server/db/schema.ts:205-238`) is the wallet a user notification would go to.
- **Receipts as event source.**
  - `features/trade/server/receipts-db.ts`: `insertPending`, then confirmed or failed, only from pending.
  - Actions confirm: `features/baskets/actions.ts` `recordActionPurchase`.
  - Devnet plans: `features/invest/server/store.ts:96`.

**Missing**
- Subscription tables, verification, an outbox (status, attempts, idempotency key, dead letter), a delivery worker and any channel code.
- No Resend, `web-push`, Telegram library, VAPID or service worker.
- No user-facing low-balance signal: the keeper checks only its own balance. A plan's funding balance would have to be read.
- No "expired" receipt status: receipts are `pending | confirmed | failed`.
- `/settings` has no Notifications section. `features/marketing/content/privacy.ts` does not mention email, push or Telegram.

## 2. P&L

**What exists**
- **`features/portfolio/components/PnLSummary.tsx`** (used by `PortfolioIsland.tsx:84`):
  - three cards: priced value plus the unpriced count; "Spent through Ovelo (confirmed)", a bigint sum of `amountIn` per `mintIn`; and "Profit and loss: Not shown: the cost basis of these holdings is unknown";
  - its doc comment still says "Full P&L arrives with M8" (stale; it is now M11).
- **`features/portfolio/valuation.ts`.** Integer fixed-point math: `valueOf` (raw × price / 10^dec, truncated), `sumFixed`, `allocationBps`.
- **`features/portfolio/server.ts`.** `getPortfolio` (SOL and token accounts, catalog prices); `toActivity`. Activity kinds are `spot | basket`.
- **Receipts** (`server/db/schema.ts:142-196`):
  - the row: `signature` pk, `wallet`, `basket_id` (creator baskets only; curated ones are null), `kind` (`spot|basket|plan_create|plan_close|installment`), `amount_in` raw text, `mint_in`, `legs` jsonb, `slot`, `block_time`, `status`;
  - each leg holds `{mint, inputAmount, outAmount, minimumAmount, tx, requestId, basket, basketVersion?}`;
  - **these are quoted amounts, not executed fills.** Exact cost basis needs either the confirmed transaction's token-balance deltas or an explicit rule that the quoted `outAmount` stands in for the fill (it is a lower bound only through `minimumAmount`). This is a decision for Step 2;
  - curated baskets are grouped by `legs[].basket` (a slug), since `basket_id` is null for them.
- `portfolio_snapshots` exists in the schema and is unused.

**Missing**
- Cost basis, realized and unrealized P&L, and per-basket grouping.
- Sells: no sell receipts exist (Ovelo buys only), so "a sell or transfer out" can only be seen from the wallet's balances or on-chain history.
- CSV export.

## 3. Onboarding

**What exists**
- **`features/wallet/onboarding.ts`.**
  - `NEW_STOCK_ACCOUNT_SOL = "0.002"` (measured 0.00156–0.00157);
  - `WALLET_INSTALL_GUIDES` for Phantom, Solflare and Backpack, linking to their download pages;
  - `solNeededNote()`.
- **Connect screen** `features/wallet/stack/WalletPicker.tsx`:
  - lists the Wallet Standard wallets that are ready, or shows a "No Solana wallet was found" state with the install links;
  - shows the mainnet SOL note (`data-testid="sol-needed"`);
  - tested in `WalletPicker.test.tsx`.
  - The adapter is in `WalletStack.tsx`. On Android, Mobile Wallet Adapter comes from the library.
- **Balances.** Read server side only: `features/portfolio/server.ts`, and the debit check in `features/trade/server/quote.ts:197`.
- **Analytics.**
  - `features/shared/components/ConsentBanner.tsx`: opt-in, stored under localStorage `ovelo.privacy.v1` for 180 days, reopened through `PrivacyChoicesButton`.
  - Plausible is called through `fetch` and enabled by `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`.
  - The only event is `pageview`, with paths reduced to categories.

**Missing**
- In-app-browser deep links for the wallets.
- A client-side "you have X SOL / Y USDC, you need Z" step.
- On-ramp links.
- A suggested first buy.
- Custom funnel events and a time-to-first-buy measurement.

## 4. Creators

**What exists**
- **`features/creators/stats.ts`.**
  - `receiptUsage` counts purchases (distinct `legs->0->>requestId`) and buyers from confirmed basket receipts over 7 d, 30 d and all time (by `created_at`), with volume per mint;
  - `getCreatorStats` adds the published and archived counts, the versions and the last publish date;
  - served by `app/api/v1/creators/[wallet]/stats/route.ts` and shown by `CreatorUsage.tsx` in `CreatorBasketDetails.tsx`.
- **Pages.** The directory `app/(app)/(shell)/creators/page.tsx`, the basket pages and the builder (`basket/new`, edit through `?from=`).
- **Blinks.**
  - `features/baskets/actions.ts` (`resolveActionBasket`, `actionHref`, `actionMetadata`, `recordActionPurchase`), with `actions-json.ts` and `actions-headers.ts`;
  - routes `app/actions.json/route.ts` and `app/api/v1/actions/baskets/[id]/{route.ts,confirm/route.ts}`.
- **Invites.** `features/creators/invites.ts` (hash-only storage, 90-day maximum), `scripts/create-invite.ts`, `/api/v1/creators/invites/redeem`.
- **`basket_versions`.** `schema.ts:122-140`, insert-only through the triggers in migration 0002.
- **Signed flows.**
  - Server `features/creators/server.ts`: `saveDraft`, `publishBasket`, `archiveBasket`, `listCreatorBaskets`.
  - Verification `features/creators/requests.ts`; client `features/creators/publish-flow.ts`.
  - Routes `POST /api/v1/creators/baskets`, `DELETE /api/v1/creators/baskets/[id]`, `POST /api/v1/creators/challenge`.

**Missing**
- `/creators/dashboard`, a creator profile page, share or copy-link buttons, and Blink-vs-app attribution. Receipts do not record whether a buy came through an Action; `recordActionPurchase` is the place it could be marked.
- **No session mechanism.** Every mutation signs a fresh single-use challenge, and there are no cookies anywhere. The dashboard's "wallet-signed session" is new design (a signed read token, similar in shape to the `at1` and `pa1` HMAC tokens in `server/auth/`). Stats are already public per wallet through `/api/v1/creators/[wallet]/stats`.

## 5. Platform fee

**What exists**
- `features/trade/server/fees.ts` `feeSummary` returns `platformFeeBps: 0`, typed as the literal `0`.
- The schema enforces `z.literal(0)` (`features/trade/schema.ts:111`), and the review screen hardcodes the row "Ovelo fee: None" (`ReviewPanel.tsx:147`).
- The Jupiter build (`features/trade/server/route.ts`, `jupiter.ts`) sends no `platformFeeBps` or `feeAccount`, and rejects a route whose `platformFee.feeBps` is not 0.
- Zero is also enforced in `lib/sdk/jupiter/instruction.ts`, `packages/guard/src/jupiter/instruction.ts:176`, `packages/guard/src/v1/mainnet/route.ts:134`, the program's `integrations/jupiter.rs:99` and `docs/audit/threat-model.md` A7.
- The fee-account budget is in `docs/REWRITE-PLAN.md:278`.

**Missing**
- Fee-share code of any kind. Option 5b would touch `features/trade/**`, `lib/sdk/jupiter/**`, the schema and the review panel, and would have to stay out of Guard paths, which keep the 0.

## Other context

- **`/settings`** (`app/(app)/(shell)/settings/page.tsx`): Appearance, Privacy, "What each mode does", and "Wallet and terms" (`features/account/components/SettingsWallet.tsx`).
- **`check:prod-env`** (`scripts/check-prod-env.ts`, `--profile production|beta`):
  - checks live in `server/prod-env.ts`, `prod-env.public.ts` and `prod-env.beta.ts`;
  - its `APP_VARIABLE` regex has no `RESEND_`, `VAPID_` or `TELEGRAM_` prefix yet.
- **E2E.**
  - `e2e/ports.ts` (3100, 3101).
  - `e2e/fork/run.ts`: RPC 8899, Jupiter stand-in 4010, app 3200; specs in `e2e/trade/`.
  - `e2e/invest/run.ts`: app 3300, keeper 8790, alert sink 4030, Redis 8079, Postgres 54329 and 54330.
- **Dependencies present:** fast-check, @axe-core/playwright, @playwright/test, msw, @upstash/redis, @upstash/ratelimit, pglite.
- **Dependencies absent:** @upstash/qstash, resend, web-push, a Telegram client.

## Success metrics (ROADMAP §4)

| Metric (target) | How it can be measured today | What is missing | Who measures |
|---|---|---|---|
| CI green on `main` (100%) | GitHub Actions history, once pushed | The branch is not pushed; CI has never run (P6) | Owner |
| Installments executed within 5 min of due (≥ 99%) | Devnet keeper only: compare `receipts.block_time` (kind `installment`) with the period's due time from `plans_index` | A query or script for the comparison; enough devnet rounds to give a percentage. Mainnet does not apply until M12 | Session (devnet, read-only, or LiteSVM/tests); owner for a longer devnet run |
| Failed installments that trigger an alert (100%) | Keeper tests cover `installment_failed` and DLQ paths; the invest E2E has an alert sink on 4030 | An explicit coverage map of failure branches to alerts; a user-facing alert (Step 1) | Session |
| Time to first basket buy (< 2 min) | Not measured | Funnel events and a fork E2E that times connect → first basket confirmed, excluding wallet UI (Step 3) | Session (fork E2E); owner for real users after the beta |
| p95 latency of `/api/markets` (< 300 ms) | Not measured. In v1, `/api/markets` became the `/api/v1/markets*` routes (Step 7 names the exact ones) | A load script against local `next start` with recorded provider responses | Session (local); owner for production |
| Critical or High audit findings open at launch (0) | `docs/AUDIT.md` and `docs/audit/*` | A recount at Step 7 | Session; external auditor for M12 |
