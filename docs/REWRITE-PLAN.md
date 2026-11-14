# Aroma v1 — Full Codebase Rewrite Plan

_Written 13 November 2026. Companion to [ROADMAP.md](./ROADMAP.md) (the phases and launch scope) and [CONTRACT-V1-SPEC.md](./CONTRACT-V1-SPEC.md) (the contract, which you own)._

This document is the engineering plan for rewriting **every part** of the prototype:
- the web app;
- the API;
- the shared chain/market/basket helpers (today `packages/sdk`, now folded into `apps/web/lib/sdk`);
- the keeper;
- styling;
- tests;
- tooling.

It says what the new system looks like, where each prototype module goes, what order to build in, and when each milestone is "done".

---

## 1. Why rewrite (not refactor)

What the prototype measured at (~74k lines):

| Problem | Evidence | Consequence |
|---|---|---|
| Every product page is client-rendered | Each product `app/*/page.tsx` is about 10 lines that render `<AromaApp page="…">`, a client-side `switch` over 12 screens | no Server Components, weak SEO, one large JS bundle, slow first paint |
| Very large components | `Details.tsx` 1,362 lines, `Account.tsx` 926, `RecurringInvestingPanel.tsx` 864, `BasketBuilder.tsx` 803, plus 6 more over 600 | hard to test, hard to change, frequent regressions |
| Three styling systems | ~5,850 lines of global CSS across 20 files, plus CSS Modules, plus Tailwind | style collisions, dead CSS, no tokens shared with mobile |
| Server state handled by hand | `useBaskets`, `useWalletPortfolio`, `useRouteHealth` and `localStorage` in 7 components | duplicated fetching, no cache invalidation, stale UI |
| The shared helpers are a grab-bag | `markets.ts` 1,143 lines, `aroma-client.ts` 954, `research.ts` 915; three `@solana/kit` versions | bundle bloat, type mismatches, unclear public API |
| Contract-coupled server code | `recurring-devnet*.ts` (~1,500 lines) built around a contract that is being replaced | can't be reused with the v1 contract |
| Repo integrity | missing `apps/mobile`, `scripts/*`, root `tests/`; no commits; broken CI | see [AUDIT.md §3](./AUDIT.md#3-repository-tooling-and-ci) |

**What we keep is the knowledge, not the files.** The prototype's tests, its HMAC trade authorization, its Jupiter and Pyth adapters and its product rules ([PRODUCT.md](../PRODUCT.md)) are ported on purpose. Everything else is rewritten.

---

## 2. Principles

1. **Server first.** Pages are React Server Components that fetch data on the server. Client components only for interaction: wallet, forms, charts, animation.
2. **Feature folders.** Each feature owns its UI, hooks, server actions, schemas and tests.
3. **One source of truth for each concern:**
   - amounts: `bigint`;
   - validation: zod schemas, shared by the API and the UI;
   - chain access: `apps/web/lib/sdk`;
   - styling: design tokens.
4. **Untrusted by default.** Every request body, external API response and on-chain account is parsed and validated, never cast.
5. **No file over 400 lines.** Lint enforces it (`max-lines`).
6. **Every module ships with tests.** CI blocks merges below the coverage thresholds.
7. **Devnet and mainnet are separate at the type level**: a `Cluster` brand type, plus genesis checks at runtime.

---

## 3. Target stack (recommended)

| Concern | Choice | Replaces |
|---|---|---|
| Framework | Next.js 15 App Router, **React 19**, Server Components + Server Actions | client `AromaApp` switch, React 18 |
| Language | TypeScript strict + `noUncheckedIndexedAccess` | strict only |
| Styling | **Tailwind v4** with tokens from `packages/ui/tokens.css` (from `styles/foundation.css` and `.21st/DESIGN.md`); CSS Modules only for complex animation | 20 global CSS files + Modules + Tailwind v3 |
| Components | shadcn/ui (Base UI primitives already in use) in `packages/ui` | ad-hoc `components/ui` |
| Server state | **TanStack Query v5** (client), `fetch` cache + `revalidateTag` (server) | hand-written hooks + `localStorage` |
| Client state | Zustand (persisted) for preferences only: theme, trading mode, watchlist | scattered `localStorage` |
| Validation | **zod** | manual checks |
| Wallets | **Standard Solana wallets only** (Wallet Standard via `@solana/wallet-adapter`: Phantom, Solflare, Backpack and any other Wallet Standard wallet; Mobile Wallet Adapter on Android; wallet in-app browsers on iOS). **No Privy and no embedded or email wallets** (owner decision, 2026-11-14; §7.3 W1) | Privy + wallet-adapter in the prototype |
| Solana | **`@solana/kit` at one pinned version**, Codama-generated client from the v1 IDL; web3.js v1 only inside the wallet-adapter bridge | web3.js v1 + kit 3.x + 7.x + 8.x |
| Database | **Postgres (Neon) + Drizzle ORM** for durable records: creators, baskets, receipts, plan index, notifications, portfolio snapshots | Redis used as a database |
| Cache, locks, rate limits | Upstash Redis + `@upstash/ratelimit` | in-memory maps, disk cache |
| Jobs | Upstash **QStash** (cron + retries + dead-letter queue) | broken GitHub cron |
| Observability | Sentry, pino JSON logs, OpenTelemetry traces (Vercel) | none |
| Testing | Vitest (unit), Playwright (E2E), LiteSVM (contract), MSW (HTTP mocks) | `node:test` mix of `.mjs`/`.cjs`/`.ts` |
| Monorepo | pnpm + Turborepo, with remote cache | same |
| Lint/format | ESLint 9 flat config + typescript-eslint + Prettier | missing |

---

## 4. Target repository layout

```
aroma/
├─ apps/
│  ├─ web/                          Next.js app
│  │  ├─ app/
│  │  │  ├─ (marketing)/            landing, privacy, terms        → static / ISR
│  │  │  ├─ (app)/                  layout with Shell + wallet providers
│  │  │  │  ├─ markets/             page.tsx (RSC), loading.tsx, error.tsx
│  │  │  │  ├─ stock/[symbol]/
│  │  │  │  ├─ baskets/ · basket/[id]/ · basket/new/
│  │  │  │  ├─ invest/              recurring plans (was /sip)
│  │  │  │  ├─ portfolio/ · activity/ · watchlist/ · settings/
│  │  │  │  └─ creators/
│  │  │  ├─ api/v1/…                thin route handlers (§6)
│  │  │  └─ actions.json/route.ts
│  │  ├─ features/                  ← all product code lives here
│  │  │  ├─ markets/   { components/, queries.ts, server.ts, schema.ts, *.test.ts }
│  │  │  ├─ stock/     research, chart, news, trade ticket
│  │  │  ├─ baskets/   list, detail, builder, performance
│  │  │  ├─ trade/     quote → review → sign → execute (spot + basket)
│  │  │  ├─ invest/    create plan, plan list, plan detail, close + revoke
│  │  │  ├─ portfolio/ holdings, allocation, P&L
│  │  │  ├─ creators/  publish flow, dashboard
│  │  │  ├─ account/   settings, privacy choices, theme
│  │  │  └─ wallet/    providers, connect button, signer abstraction
│  │  ├─ server/                    server-only infrastructure ("server-only" import)
│  │  │  ├─ env.ts                  zod-validated environment, fails fast at boot
│  │  │  ├─ db/                     Drizzle schema + migrations
│  │  │  ├─ redis.ts · ratelimit.ts · logger.ts · errors.ts
│  │  │  ├─ rpc.ts                  mainnet/devnet connections with genesis guard
│  │  │  └─ auth/                   trade-authorization, creator-auth, keeper-auth
│  │  ├─ lib/sdk/                   chain, market and basket helpers (formerly the @aroma/sdk package)
│  │  │  ├─ core/ guard/ jupiter/ pyth/ markets/ research/ baskets/ paper/ server/
│  │  ├─ middleware.ts              HTTPS, CSP nonce, origin, rate limit
│  │  └─ e2e/                       Playwright specs
│  └─ keeper/                       QStash-triggered collector service
│     ├─ src/scan.ts · build.ts · submit.ts · alerts.ts
│     └─ test/
├─ packages/
│  ├─ contracts/                    Anchor workspace: aroma_guard v1 (you own this)
│  ├─ ui/                           tokens.css, shadcn primitives, AssetAvatar, Change, Brand…
│  └─ config/                       tsconfig.base.json, eslint.config.js, prettier, vitest preset
├─ docs/
└─ .github/workflows/  ci.yml · contracts.yml · e2e.yml · deploy.yml
```

> **Decision (M0): `packages/anchor` is not renamed to `packages/contracts` yet.** AGENTS.md, the Anchor tooling (`idl:sync` writes into `apps/web/lib/sdk/guard/`), the root `test:anchor` and `build:anchor` scripts, and the new `contracts.yml` path filter all name `packages/anchor`, and M0 must not move contract code. `packages/contracts` is created as a sibling **when the v1 program is scaffolded** (you own that work, Phase 1 of the ROADMAP). The prototype `packages/anchor` stays until M9 (cutover), then is deleted (§9 step 3). When `packages/contracts` appears, update in one change: AGENTS.md, `contracts.yml` paths, `idl:sync`, `CODEOWNERS` and the root scripts.

---

## 5. Module-by-module mapping

Legend: **Port** = move the logic over with light cleanup and its tests · **Rewrite** = new code, using the old code only as a reference · **Drop** = delete.

### 5.1 Shared helpers (`apps/web/lib/sdk`, ~12.9k lines, formerly `packages/sdk`)
_The separate package is gone. The code already lives in the web app and keeps the `@/lib/sdk` import path. The mapping below describes how its files are split further, not a new package._
| Prototype | Lines | → v1 | Action |
|---|---|---|---|
| `markets.ts` | 1,143 | `markets/catalog.ts`, `markets/sources/{xstocks,backpack,prestocks}.ts` | **Rewrite** (split by source, zod-parse responses) |
| `research.ts`, `research-client.ts`, `market-pulse.ts` | 1,212 | `research/*` | **Port + split** |
| `pyth-oracle.ts`, `pyth-streaming.ts` | 918 | `pyth/*` | **Port** |
| `jupiter.ts`, `jupiter-instruction.ts`, `jupiter-route-plan.ts`, `jupiter-idl/*` | ~1,450 | `jupiter/*` | **Port** (shared by the keeper and spot trading) |
| `trading.ts`, `simulation.ts`, `simulation-errors.ts`, `mint-precision.ts` | 766 | `core/amounts.ts`, `jupiter/simulate.ts`, `core/errors.ts` | **Port** |
| `basket/*` (performance, custom, mainnet, bundle, atomic-swap, liquidity, route-health, transaction-limits) | ~2,150 | `baskets/*` | **Port + split** (`performance.ts` 605 lines → 3 files) |
| `rebalance.ts`, `paper.ts`, `creator.ts` | 358 | `baskets/rebalance.ts`, `paper/*`, `baskets/creator.ts` | **Port** |
| `client/aroma-client.ts`, `client/recurring-client.ts`, `state/aroma-core.ts`, `portfolio/cache.ts` | ~1,720 | replaced by feature `queries.ts` + TanStack Query | **Rewrite** |
| `guard/*` (devnet.ts, aroma_guard.ts/json, client.ts) | ~1,640 | `guard/generated` (Codama from the v1 IDL) + `guard/builders.ts` | **Rewrite** against the v1 contract |
| `subscriptions/mainnet.ts`, `recurring-investing.ts` | 633 | `guard/subscriptions.ts` | **Rewrite** |
| `devnet-xstocks.ts` | 236 | `markets/sources/devnet.ts` (reads the v1 asset registry on-chain) | **Rewrite** |
| `backpack.ts`, `meteora.ts` | 548 | `markets/sources/backpack.ts`; drop Meteora unless a route needs it | **Port / decide** |
| `mobile-signer.ts`, `wallet-capabilities.ts`, `index.native.ts` | 93 | postpone until mobile | **Drop for v1** |
| Raydium CPMM helpers, `*V2` aliases | — | — | **Drop** |

### 5.2 Server (`apps/web/lib/server`, ~7.1k lines)
| Prototype | → v1 | Action |
|---|---|---|
| `trade-authorization.ts`, `bundle-authorization.ts` | `server/auth/trade.ts` | **Port** (add a zod-parsed payload and a key version for rotation) |
| `creator-auth.ts` | `server/auth/creator.ts` | **Port** (single-use invites stored in Postgres) |
| `recurring-keeper.ts` (auth part) | `server/auth/keeper.ts` (QStash signature verification) | **Rewrite** |
| `request-policy.ts` | `server/http.ts` (`readLimitedJson`) + `server/ratelimit.ts` (Upstash) | **Port + rewrite** |
| `redis.ts`, `route-health-cache.ts`, `disk-cache.ts` | `server/redis.ts`, `server/cache.ts` | **Rewrite**; drop disk cache |
| `markets.ts`, `holdings.ts`, `swap-tokens.ts`, `mint-precision.ts` | `features/markets/server.ts`, `features/portfolio/server.ts` | **Rewrite** around `lib/sdk` |
| `basket-order.ts` (870), `composed-transactions.ts`, `jupiter-build.ts`, `jupiter-lookup-tables.ts`, `trade-simulation.ts`, `jito-bundles.ts` | `features/trade/server/{quote,build,simulate,submit,bundle}.ts` | **Rewrite** (split; logic from `lib/sdk`) |
| `basket-receipts.ts`, `basket-route-health.ts` | `features/baskets/server/*` + `receipts` table | **Rewrite** |
| `creator-store.ts`, `creator-reconciliation.ts` | `features/creators/server.ts` + Drizzle | **Rewrite** |
| `recurring-devnet*.ts`, `recurring-actions.ts` (~1,735) | `features/invest/server.ts` (prepare create/close) + `apps/keeper` (execute) | **Rewrite** for the v1 contract |
| `basket-buy-actions.ts` | `features/baskets/actions.ts` (Solana Actions) | **Port** |
| `faucet.ts` | `features/invest/faucet.ts` | **Rewrite** (Turnstile, Redis limits by wallet + IP, daily budget) |
| `devnet-connection.ts`, `mainnet-connection.ts` | `server/rpc.ts` | **Port** (genesis guard kept) |
| `lib/company-logos.ts` (387) | `packages/ui/logos.ts` (generated from `public/company-logos`) | **Rewrite as generated code** |
| `lib/metadata.ts`, `lib/site.ts`, `lib/pending-mainnet.ts`, `lib/recurring-links.ts` | `app/` metadata helpers, `features/*` | **Port** |

### 5.3 UI (`apps/web/components`, ~14.8k lines + 5.8k CSS)
| Prototype | → v1 feature | Split into |
|---|---|---|
| `AromaApp.tsx`, `Shell.tsx` | `app/(app)/layout.tsx` + `features/account/components/Shell/*` | the layout is an RSC; the nav is a small client island |
| `Discover.tsx` (704), `MarketUI.tsx` (671), `MarketPulse.tsx`, `BackpackCatalog.tsx` | `features/markets` | `MarketTable`, `MarketFilters`, `PulseStrip`, `CatalogSourceBadge` |
| `Details.tsx` (1,362), `StockResearch.tsx` (718) | `features/stock` + `features/baskets` | `StockHeader`, `PriceChart`, `ResearchTabs`, `NewsList`, `TradeTicket`; `BasketHeader`, `AllocationTable` |
| `BasketBuilder.tsx` (803), `BasketPerformancePanel.tsx` (538) | `features/baskets` | `BuilderForm`, `AssetPicker`, `WeightEditor`, `PerformanceChart`, `PerformanceStats` |
| `ActualTradePanel.tsx` (710), `ActualBasketPanel.tsx`, `TradeTransfer.tsx`, `SwapTokenSelector.tsx`, `useComposedTransaction.tsx`, `PaperSwap.tsx` | `features/trade` | one `useTradeFlow` state machine (quote → review → sign → submit → confirm) shared by stock, basket and paper |
| `RecurringInvestingPanel.tsx` (864), `DevnetPlansList.tsx` (757) | `features/invest` | `PlanWizard` (steps), `PlanCard`, `PlanTimeline`, `ClosePlanDialog` |
| `Account.tsx` (926), `ActualPortfolio.tsx`, `PortfolioAllocation.tsx`, `useWalletPortfolio.ts` | `features/portfolio` + `features/account` | `HoldingsTable`, `AllocationDonut`, `PnLSummary`, `ActivityList`, `SettingsForm` |
| `CreatorDashboard.tsx`, `creator-client.ts` | `features/creators` | `PublishFlow`, `CreatorStats` |
| `TradingAuth.tsx`, `PrivyAuthProvider.tsx`, `WalletButton.tsx`, `app/wallet-providers.tsx`, `app/providers.tsx` | `features/wallet` | one `WalletProvider`, `ConnectButton`, `useSigner()` |
| `PrivacyChoices.tsx`, `ThemeMode.tsx`, `State.tsx`, `useTradingMode.ts`, `TradingModeSwitch.tsx` | `features/account` + Zustand store | |
| `Landing.tsx` (630) + `Landing.module.css` | `app/(marketing)/page.tsx` + `features/marketing/*` | static RSC sections; GSAP only inside a lazy client island |
| `components/ui/*`, `Brand`, `AssetAvatar`, `Change`, `SocialLinks`, `LegalPage` | `packages/ui` | |
| `styles/*.css` (20 files) | `packages/ui/tokens.css` + Tailwind | **Drop** the global CSS; recreate the visuals with tokens |

### 5.4 API routes
| Prototype | → v1 (`/api/v1/…`) | Notes |
|---|---|---|
| `markets`, `tokens`, `research`, `news` | mostly **gone**: RSC pages call `features/*/server.ts` directly. Keep `GET /api/v1/markets` and `/research/:symbol` for public or mobile use | ISR + `revalidateTag` |
| `portfolio` | `GET /api/v1/portfolio/:wallet` | |
| `trade/order`, `trade/execute`, `transaction/execute`, `buy-basket`, `bundles/execute`, `bundles/status` | `POST /api/v1/trade/quote`, `POST /api/v1/trade/submit`, `GET /api/v1/trade/:id` | one flow for single stocks and baskets; the quote returns `{ transactions[], authorization }` |
| `baskets/performance`, `baskets/route-health` | `GET /api/v1/baskets/:id/performance`, `…/health` | |
| `creators/challenge`, `creators/baskets`, `creators/baskets/[id]`, `creators/stats` | `POST /api/v1/creators/challenge`, `POST /api/v1/creators/baskets`, `GET/DELETE /api/v1/creators/baskets/:id`, `GET /api/v1/creators/:wallet/stats` | |
| `recurring`, `recurring/config`, `recurring/revoke`, `recurring/execute`, `recurring/collect` | `POST /api/v1/plans/prepare-create`, `POST /api/v1/plans/:pda/prepare-close`, `GET /api/v1/plans?owner=` · execution moves to `apps/keeper` (`POST /keeper/run`, signed by QStash) | |
| `faucet` | `POST /api/v1/faucet` (Turnstile token required) | devnet only |
| `actions/*`, `actions.json` | same paths (the Solana Actions spec fixes them) | **Port** |
| `health` | `GET /api/v1/health` (real checks) | |

Every handler has the same shape: `parse(zodSchema) → service call → typed result → mapError()`. Errors return `{ code, message }`, with internal details only in logs.

---

## 6. Data model (Postgres + Drizzle)

```
creators         (wallet pk, display_name, social, created_at, invite_id)
invites          (id pk, code_hash, max_uses, uses, expires_at)
baskets          (id pk, creator_wallet fk?, name, ticker, category, description,
                  status[draft|published|archived], version, created_at, published_at)
basket_allocations (basket_id fk, mint, symbol, weight_bps)            -- weights sum to 10,000
receipts         (signature pk, wallet, basket_id?, kind[spot|basket|plan_create|plan_close|installment],
                  amount_in, mint_in, legs jsonb, slot, block_time, status)
plans_index      (pda pk, owner, funding_mint, nonce, status, next_due_at, last_period,
                  skipped_periods, updated_at)                         -- mirror of on-chain state for the keeper and UI
notifications    (id pk, wallet, channel[email|push|telegram], event, payload jsonb, sent_at)
portfolio_snapshots (wallet, taken_at, holdings jsonb, value_usd)      -- P&L history
```

Redis is kept only for caches, rate limits, keeper leases (`lease:plan:{pda}:{period}`) and idempotency keys.

---

## 7. Build order and exit criteria

Each milestone is merged to `main` behind feature flags. The prototype stays deployed until M9. **Finishing M11 means the product is launched.**

| # | Milestone | Scope | Exit criteria |
|---|---|---|---|
| **M0** | Foundation (week 1) | tag `prototype-final`; new layout; `packages/config`; ESLint, Prettier, Vitest; CI; `server/env.ts`; Sentry + logger; Neon + Drizzle + first migration; Upstash | empty app deploys to a preview URL; CI green; env validation fails on a missing secret |
| **M1** | Design system (week 1–2, **implemented**, see status below) | `packages/ui`: tokens from `foundation.css` and `DESIGN.md`, Tailwind v4, shadcn primitives, `Brand`/`AssetAvatar`/`Change`, light and dark, reduced motion | Storybook or Ladle page for every primitive; axe has zero violations |
| **M2** | Shared helpers cleanup (weeks 1–3, **implemented**, see status below) | in `apps/web/lib/sdk`: `core/`, `pyth/`, `jupiter/`, `markets/`, `research/`, `baskets/`, `paper/` ported with their tests | ≥ 85% coverage; one `@solana/kit` version; no `any` in public types |
| **M3** | Read-only app (weeks 2–4, **implemented**, see status below) | marketing pages, markets, stock detail, baskets list and detail, watchlist, all as RSC with ISR | Lighthouse ≥ 90 on performance, SEO and accessibility; meets PRODUCT.md data rules (sources, timestamps, stale states) |
| **M4** | Wallet + spot trading (weeks 3–6, **implemented**, see status below) | `features/wallet`, `features/trade` (single stock + basket, Jito bundles), receipts, portfolio | Playwright test buys on a mainnet fork or simulator; ported authorization tests pass; rate limits and CSP nonces live |
| **M5** | Creators (weeks 5–6, **implemented**, see status below) | publish flow, invites table, dashboard, Solana Actions | creator E2E; single-use invites enforced |

From M6 on, each milestone has a contract part and an app part. Steps marked **(owner)** are done by the product owner, never by an agent: deploys, DNS, choosing the auditor, the multisig.

| # | Milestone | Contract | App | Exit criteria |
|---|---|---|---|---|
| **M6** | Contract v1 core + devnet deploy | `packages/contracts`: config, asset registry, plan; admin and plan instructions; devnet-mock `execute_installment` minting at the oracle price, with funding to a treasury; catch-up and skip; pause; typed Subscriptions layout; security requirements of spec §7 | Codama client and builders in `lib/sdk/guard/v1`; IDL drift test | LiteSVM suite green; local validator end to end (create → 3 periods → close + revoke); deployed to devnet **(owner)**; config initialized; test assets registered |
| **M7** | Recurring investing on devnet (was M6) | integration fixes only | `features/invest`, `apps/keeper` on QStash (leases, retries, dead-letter queue, alerts), `plans_index`, faucet with Turnstile and Redis limits (AUDIT H-5) | create → 3 installments → close + revoke on devnet; skipped periods shown; keeper alerting tested |
| **M8** | Contract mainnet path (**implemented**, see status below) | Jupiter CPI, oracle-bounded `min_out`, owner-ATA delivery check, multi-leg execution; full LiteSVM with pinned Jupiter, Pyth and Subscriptions binaries; proptest/fuzz; verifiable build | keeper Jupiter routes; mainnet build behind a flag | full suite on a mainnet fork; fuzz clean; verifiable build hash recorded |
| **M9** | Cutover (was M7) | none | v1 on the production domain **(owner: DNS)**, `/v1` prefix and prototype routes removed with their unused code (including `packages/anchor`), prototype CSP and error residue closed; spot and basket trading go live; **compliance gate** implementing counsel's decisions (**P1**): geo-blocking, terms acceptance before the first trade, risk disclosure on every trade review | production serves v1 only; **compliance gate live before spot trading opens**; production readiness **P3**, **P4** (spot items), **P5** (spot) and **P6** met (§7.1) |
| **M10** | Mainnet recurring on the budget path (no program deploy, §7.2) | none: Aroma Guard v1 stays on devnet | **Spike first:** confirm with a real owner test (P5) that Jupiter DCA accepts xStocks (they carry a transfer-hook extension, and DCA rejects transfer-hook tokens unless whitelisted). If it does: recurring plans on mainnet become one Jupiter DCA order per basket constituent, created from `/v1/invest` and signed by the user's wallet. **Limits are shown to the user, not hidden:** the full budget is deposited upfront into the user's Jupiter DCA vault (not pulled per period), each round is at least $10, at most 10 active DCA orders per wallet (so baskets of ≤ 10 constituents per wallet), no integrator fee. If it does not: mainnet recurring waits for M12, and `/v1/invest` keeps offering the devnet beta with an honest "mainnet coming" state | spike result recorded; if accepted: create → 2 rounds → cancel on mainnet by the owner (P5), positions in the portfolio, compliance gate applied; if rejected: devnet beta stays public and M12 is the path |
| **M11** | Launch features (was M8) | none | notifications, P&L, onboarding, creator fee share, creator dashboard | **launch**: launch checklist complete; ROADMAP success metrics measured; §7.1 launch items done; **every step within the ≤ $5 SOL budget (§7.2)** |
| **M12** | Aroma Guard v1 on mainnet (when funded, after launch) | external audit and fixes (auditor booked, **P2**; reschedule to when funding is in place); Squads multisig (≥ 2-of-3, timelock) as upgrade authority **(owner)**; mainnet deploy with launch caps **(owner)**; real xStocks registered | mainnet recurring on Aroma Guard (pull per period, no upfront deposit, no $10 minimum) behind caps; keeper mainnet mode on; monitoring and alerts; migrate users from DCA plans only by their own choice | **funding in place: ≥ 5 SOL in the mainnet deployer (§7.2)**; audit findings closed; multisig verified on-chain; first mainnet installments monitored; **P4** (contract items) and **P5** (Aroma Guard recurring) met |

### 7.1 Production readiness (owner and launch gates)

The goal is a production product for buying real tokenized stocks (xStocks) on Solana mainnet, singly or in baskets, with creators and recurring investing. These items sit outside session-built code but gate launch. Sessions prepare checklists, scripts and docs for them; the **owner** does every step that needs an account, a key, money or a signature.

| # | Item | Status | Gates |
|---|---|---|---|
| **P1** | **Legal and compliance advice**: who may buy xStocks (not US persons, other restricted jurisdictions), terms, risk disclosures, and the regulatory position of baskets and creators | ✅ **Done (owner).** M9's compliance gate (geo-blocking, terms acceptance before the first trade, risk disclosure on every trade review) implements counsel's decisions; moved from M11 to M9 so it is live before spot trading opens | M9 |
| **P2** | **External audit booked** for Aroma Guard v1 | ✅ **Done (owner).** The audit runs in M12 (moved from M10 by the budget, §7.2), on the M8 code and its verifiable build; reschedule the slot to when the deploy is funded | M12 |
| **P3** | **Production accounts and keys**: Jupiter API key (keyless rate limits leave most assets unpriced); paid RPC with failover (Helius or Triton); Pyth Hermes key; Upstash (Redis, QStash); Neon (Postgres); Sentry; Cloudflare Turnstile; Vercel project and domain; alert webhook | 🟨 **Prepared (owner to execute).** Every variable by service, where to get it, plan and milestone: [launch/PRODUCTION-ENV.md](launch/PRODUCTION-ENV.md); `pnpm check:prod-env` validates the production profile (real schemas, no placeholder or test values, mainnet genesis read-only); RPC failover implemented in M9 Phase B (`SOLANA_RPC_FALLBACK_URL`, PRODUCTION-ENV §3; a second provider is still the owner's). Boot still fails on a missing variable (`server/env.ts`). The Sentry DSN schema accepts a real DSN (W4, `server/env.sentry.ts`) | spot items at M9; Hermes, QStash and keeper items at M10 |
| **P4** | **Key custody**: separate deployer wallets for devnet and mainnet (mainnet funded only for the deploy); backups of the program keypair; the v1 upgrade authority on a Squads multisig (≥ 2-of-3, timelock); mainnet keeper key in a secret store, distinct from devnet; `AROMA_TRADE_SECRET` rotation plan (key id + previous key); no key ever in git (the secret scans enforce it) | 🟨 **Prepared (owner to execute).** Runbook: [launch/KEY-CUSTODY.md](launch/KEY-CUSTODY.md); trade-secret rotation drill test (`server/auth/trade-rotation.drill.test.ts`); read-only `pnpm check:custody` (upgrade authority, config admin, keeper vs. expected; tested, and run against devnet: not deployed yet) | trade secret and rotation at M9; deployer, multisig and mainnet keeper at M12 (none needed before, §7.2) |
| **P5** | **Small real-money mainnet tests** before opening to users: the owner buys one stock and one basket with small amounts and checks receipts, portfolio, fees and the explorer (`M4-DEPLOY.md` §4); for recurring, a capped plan runs real installments, then close + revoke | ⬜ Owner. Everything before this point ran on a fork, LiteSVM or devnet; no session sends real-money transactions. Budget: these tests are paid in USDC; their SOL cost is network fees and token-account rent only (§7.2) | spot at M9 (before opening to users); DCA spike and recurring at M10 (about $20 USDC: 2 rounds × $10 minimum); Aroma Guard recurring at M12 |
| **P6** | **Merge, CI and `main` protection**: push the stacked milestone branches (M0 → M7 …), get `ci.yml`, `contracts.yml` and the E2E workflows green on GitHub, merge to `main`, and protect `main` (required checks, reviews, no force-push) | 🟨 **Prepared (owner to execute; CI not verified).** [launch/MERGE-PLAN.md](launch/MERGE-PLAN.md): linearity check, `prototype-final` tag, push order, required check names, exact `gh api` protection commands (not run), secrets per job, pre-push local gate baseline. Production deploys only from `main` | before M9's production deploy |

**Order to launch:** M7 → owner devnet deploy (M6) → M8 (built and audit-ready, not deployed) → **P6, P3 (spot), P4 (trade secret), P1 compliance gate, P5 (spot)** → M9: spot and baskets live on mainnet → M10: recurring on mainnet through Jupiter DCA if the xStocks spike passes, otherwise the devnet beta → M11 → **launch** → M12 when funded: Aroma Guard v1 on mainnet.

### 7.2 SOL budget: at most $5 of SOL until M12

**Rule:** no step before M12 may need more than **0.068 SOL** in any owner wallet (= $5 at $73.49 per SOL, Jupiter price on 2026-11-14; recheck the price at each step and keep a 30% reserve). Any step that would need more is moved to M12 or redesigned. Users pay their own network fees and token-account rent, as on every Solana app.

Measured on 2026-11-14 with `solana rent` on mainnet for the M8 default build (`aroma_guard.so`, 486,536 bytes):

| Mainnet item | SOL | Fits the budget? | Milestone |
|---|---|---|---|
| Aroma Guard program data account (refundable rent, stays locked) | 2.4725 | ❌ | M12 |
| Upload buffer during the deploy (refunded when it finishes) | 2.4724 | ❌ (peak about 4.97 SOL in the deployer) | M12 |
| Config account, asset accounts (0.0016 each), treasury token accounts, Squads multisig, mainnet keeper fee float | about 0.03–0.06 | ✅ but useless without the program | M12 |
| Spot and basket trading (M4/M9): Jupiter swaps, no Aroma program | 0 for the owner; users pay their fees | ✅ | M9 |
| P5 spot tests: network fees plus a few token accounts (Token-2022 ATAs about 0.002–0.003 each) | about 0.01–0.02 | ✅ | M9 |
| Jupiter DCA spike and test (owner wallet: fees and token accounts; the deposit itself is USDC) | about 0.01 | ✅ | M10 |
| Devnet (Aroma Guard v1, keeper, faucet) | 0 (devnet SOL) | ✅ | M6–M7, beta |
| Platform fee accounts, if a platform fee is turned on later (about 0.002 per fee mint) | about 0.002–0.006 | ✅ | M11 (optional) |

**Consequences for the plan**
- Aroma Guard v1 is fully built, tested on a mainnet fork and audit-ready (M8), but **not deployed to mainnet until M12**, when about 5 SOL (about $365 at today's price, of which about $182 stays locked as refundable rent) is funded through a grant, revenue or an investor.
- **Launch (M11) needs no program deploy**: spot and basket trading through Jupiter, creators and Actions, compliance gate, and recurring through Jupiter DCA if the M10 spike passes (otherwise the public devnet beta).
- No mainnet keeper, keeper key, multisig or mainnet deployer is needed before M12.
- Shrinking the program (size-optimised build) lowers M12's cost (for example 20–40%) but cannot bring it under $5; measure it in M12, not before.

### 7.3 Mainnet deployment phases

Each phase is a deploy to mainnet users. Phases A and B fit the §7.2 budget; the SOL figures are the owner's own spend (users pay their own fees and token-account rent).

| Phase | Where and who | What is live on mainnet | Work before it | Owner SOL |
|---|---|---|---|---|
| **A. Private beta** | `beta.<domain>`, a separate Vercel project with `AROMA_V1_ENABLED=true`; invited testers only. The prototype stays on the main domain | spot and basket buying through Jupiter, creators and Actions, portfolio, compliance gate; recurring only as the **devnet** beta, labelled as test tokens | **W1** wallet-only login (Privy removed from v1), **W2** beta access gate, **W3** per-trade caps, **W4** the Sentry DSN schema fix; P3 minimum accounts (mainnet RPC, Neon, Upstash, `AROMA_TRADE_SECRET`, Jupiter API key, Vercel and domain); P5 spot tests; P6 pushed and deployed from the merged tip | about 0.007 SOL (one stock and a three-stock basket; measured 2026-11-14: an xStock token account is 179–182 bytes, 0.00156–0.00157 SOL); **fits $1.50** |
| **B. Public launch of spot (M9)** | the production domain; the `/v1` prefix and the prototype removed | everything in A, open to allowed jurisdictions; W2's gate switched off; W3's caps raised or kept per counsel | M9 cutover (including removing the prototype's Privy code and the `@privy-io/react-auth` dependency), P3 complete for spot, P4 trade-secret rotation, P6 with CI green and `main` protected | none beyond fees |
| **C. Mainnet recurring, budget path (M10)** | production | recurring through Jupiter DCA, if the xStocks spike passes; otherwise the devnet beta stays | M10 spike (about $20 USDC) | about 0.01 SOL |
| **D. Launch (M11)** | production | launch features (notifications, P&L, onboarding for wallet users, creator fee share and dashboard) | M11 | 0–0.006 SOL |
| **E. Aroma Guard on mainnet (M12, when funded)** | production | recurring on Aroma Guard v1 | M12: audit, multisig, deploy | about 4.97 SOL peak, about 2.47 locked (refundable) |

**Workstreams for phase A** (one session; each item has tests, and the beta deploy waits for all four). **All four done on branch `phase-a-beta`** (not pushed, nothing deployed; see "Phase A status" below):
- **W1. Wallet-only login: remove Privy from v1.** Delete `features/wallet/stack/PrivyEmbedded.tsx` and the Privy branches in `features/wallet/{context.tsx,WalletBoundary.tsx,stack/WalletStack.tsx,stack/WalletPicker.tsx}`, so the picker lists Wallet Standard wallets only. Message signing (`signMessage`, M5) uses `solana:signMessage` or the adapter's `signMessage`; wallets that cannot sign messages keep their clear refusal. Remove Privy from `server/env.schema.ts` (v1 profile), `server/prod-env.ts` and its tests, `server/csp.ts` (Privy hosts out of `connect-src` and `frame-src` for v1), `scripts/check-client-secrets.mjs`, `.env.example` (v1 section), `features/marketing/content/privacy.ts` (no Privy data processor) and the launch docs (PRODUCTION-ENV, KEY-CUSTODY). Update the E2E test wallet if it relied on Privy (it should not: it is a Wallet Standard bridge). The prototype keeps its own Privy code until M9 removes the prototype, so the `@privy-io/react-auth` dependency is deleted in M9, not before; a lint rule forbids importing it from v1 code from W1 on. **No embedded or email wallets means** users need a Solana wallet and a little SOL before their first buy: the connect screen links to install guides for Phantom, Solflare and Backpack, explains the SOL needed (about 0.002 SOL per new stock plus fees), and the onboarding funnel (M11) is designed for wallet users. **✅ Done (Phase A):** `PrivyEmbedded.tsx` deleted, the picker lists Wallet Standard wallets only on mainnet and devnet, message signing via `solana:signMessage` or the adapter; Privy out of the v1 env schema, prod-env, CSP, secret scan, `.env.example` (v1 sections) and privacy text; a v1 lint rule (`apps/web/eslint.config.mjs`, proven by `scripts/eslint-v1-imports.test.ts`); the connect screen links Phantom, Solflare and Backpack and states the SOL from one constant (`features/wallet/onboarding.ts`). `grep -ri privy` over the v1 paths is empty.
- **W2. Beta access gate.** A wallet allowlist and single-use invite codes (reuse the M5 invite table pattern and wallet-signed redemption), checked in middleware for every trading entry point (quote, submit, creator buys, Actions POST) and shown honestly in the UI. Off by a single config flag at phase B. **✅ Done (Phase A):** [launch/BETA-ACCESS.md](launch/BETA-ACCESS.md): `AROMA_BETA_GATE` (on by default in production), migration `0005_beta_access`, admin CLI `beta:invite`, wallet-signed atomic redemption (25-way parallel on PGlite and local Postgres), middleware plus handler checks (location → beta → terms), Action GET disabled, fail closed without a database, fork E2E `e2e/trade/beta-gate.spec.ts`.
- **W3. Per-trade caps.** A maximum notional per trade and per wallet per day (config, raw USDC units, `bigint`), enforced server-side at quote and submit, shown on the review screen; defaults for the beta, for example $50 per trade and $200 per day. **✅ Done (Phase A):** [launch/TRADE-CAPS.md](launch/TRADE-CAPS.md): `AROMA_MAX_{TRADE,DAILY}_USDC_RAW` (bigint; refused unset or 0 in production), notional = authorized maximum debit (priced, never guessed), quote checks, an atomic Postgres reservation per authorization at submit (migration `0006_trade_caps`), "max $50 per trade, $X left today" on the review, fast-check properties and concurrency tests, fork E2E `e2e/trade/caps.spec.ts`.
- **W4. Sentry.** Fix the boot schema that refuses a real Sentry DSN (found in launch prep), or keep Sentry off for phase A and fix it before phase B. **✅ Done (Phase A):** a dedicated `sentryDsn` schema (`server/env.sentry.ts`): https, one 32-hex public key and no password, an `o<org>.ingest[.<region>].sentry.io` host, a numeric project; `prod-env` passes a real-shaped DSN and fails malformed ones.

> **M8 plan notes (recorded in M7, decided in M8).**
> 1. **Executor choice of price update.** When `keeper_authority` is `None`, any executor may pass any valid, fully verified `PriceUpdateV2` inside the staleness window, so it can pick the most favourable price in that window. The mainnet path must bound this, for example by requiring the update's `publish_time` to be no older than the newest one the keeper could fetch, or by keeping keeper-only execution on mainnet. Decide in M8.
> 2. **Subscriptions binary on mainnet.** Mainnet runs an older Subscriptions build (≈ v0.4.0, slot 438,440,823) than the pinned devnet binary (`program-v0.5.0`). Re-verify the account layouts and `validate_recurring_transfer` against mainnet's binary before any mainnet deploy.
> 3. **Rust coverage** needs `cargo-llvm-cov`, an install the owner must approve.

> **Renumbering (M6, Part 0).** The M0–M5 status sections below, and some AUDIT.md lines written before this change, use the old numbers. Read them as: old **M6** (recurring on v1) = new **M7**; old **M7** (cutover) = new **M9**; old **M8** (launch features) = new **M11**. The status sections are kept as recorded.

### M0 status: implemented on branch `m0-foundation` (not pushed, not merged, nothing deployed)

- [x] Baseline recorded; tag `prototype-final` (already existed at `e85d128`, so it was not recreated)
- [x] Repo integrity (AUDIT C-3)
- [x] `packages/config`, empty `packages/ui` and `apps/keeper`
- [x] ESLint 9 + Prettier + Vitest, wired through Turbo (`pnpm lint`, `typecheck`, `test`, `build`)
- [x] `apps/web/server/`: env, logger, errors, http, redis, ratelimit, lease, rpc, db (Drizzle + Neon)
- [x] Sentry (no-op without a DSN) and `GET /api/v1/health`
- [x] `ci.yml`, `contracts.yml`, Dependabot, CODEOWNERS, PR template, `engines`
- [x] `(app)` and `(marketing)` route-group skeleton; `pnpm build:web` passes with `.env.example` and fails without a required secret
- [ ] **Open:** an actual preview deploy (needs a Vercel project), the first CI run on GitHub (needs a push), a migration applied to a real Neon database, `LICENSE` choice

**Baseline measured at M0** (differs from the AUDIT figures, which were from an earlier snapshot): `tsc` had 1 error (a missing `scripts/check-client-secrets.mjs` import), not 4. `pnpm test` ran 457 tests, 452 passed, and 5 test files failed because they import scripts that were never committed. After M0: 472 prototype tests, 456 pass, 0 fail, **16 skipped** (each marked `TODO(milestone)`):

| Skipped test file | Missing script | Restored in |
|---|---|---|
| `client-secret-scan.test.mjs`, `secrets-configuration.test.mjs` | `scripts/check-client-secrets.mjs` | M4 (CI bundle secret scan) |
| `devnet-authority-audit.test.mjs` (4 tests) | `scripts/audit-devnet-recurring.mjs` | M6 (audit for the v1 contract) |
| `sdk/devnet-xstocks.test.ts` (8 tests) | `scripts/create-devnet-xstocks.cjs` | M6 (provisioning against the v1 registry) |
| `sdk/devnet-xstocks.test.ts` (1 test) | none: a **real, pre-existing failure** the import crash had hidden. The devnet catalog lists SBUX, RTX, COP, CAT, DE and GE, which no canonical basket uses | M6 (devnet catalog rewrite) |
| `dev-tunnel-limits.test.ts` | `scripts/dev-api-tunnel.mjs` (mobile only) | post-v1 mobile |

**Deviations and decisions**

1. **`AROMA_V1_ENABLED` gates env enforcement.** The prototype stays deployed and has none of the v1 services (Postgres, Upstash, trade secret) configured. If boot validation required them unconditionally, merging M0 would take the prototype down. With the flag unset, boot validation is skipped; with it `true`, any missing or invalid variable makes the process exit 1 and `pnpm build` fail. Format rules still apply to any variable that is set. Remove the flag at M7.
2. **Drizzle uses the Neon WebSocket `Pool`, not `neon-http`**, because transactions are needed (a basket and its allocations are written together and the weights rule is checked at COMMIT).
3. **The weights-sum rule is two deferred constraint triggers** in a custom migration (`0001_basket_weights_trigger.sql`), because it spans rows. It applies once `status = 'published'`; drafts may hold partial weights.
4. **"Slot lag" in `/api/v1/health`** is measured as the age of a recently confirmed slot's block time (ok ≤ 15 s, degraded ≤ 60 s, then fail), after the genesis-hash check. No reference RPC is needed. The RPC check covers mainnet only; devnet joins at M6.
5. **Genesis constants are repeated in `server/rpc.ts`**, not imported from `lib/sdk`, because the strict tsconfig must not pull legacy files into its checks. Tests assert they equal the prototype's constants.
6. **Strictness applies to new code only.** `tsconfig.strict.json` (with `noUncheckedIndexedAccess`) covers `server/`, `observability/`, `app/api/v1`, `app/(app)` and `app/(marketing)`. ESLint reports prototype code as warnings (219 today, 0 errors), and Prettier skips prototype paths (`.prettierignore`). `max-lines` is a warning for the 30 files listed in `packages/config/max-lines-allowlist.json` (shrink only) and an error for any other file.
7. **Turbo:** `envMode: loose`, and the build task hashes the env variables the check reads. Without that, a cached build is replayed after a secret is removed and the check never runs.
8. **Sentry** is imported dynamically and only when a DSN is set; `withSentryConfig` (source-map upload) only when `SENTRY_AUTH_TOKEN` is set. Events are scrubbed of user identity, IPs, cookies, headers, bodies, query strings and wallet addresses.
9. **`pnpm test` excludes `@aroma/anchor`.** Its LiteSVM runtime tests need SBF fixtures (`target/test-programs/*.so`) and were never part of `pnpm test`. Use `pnpm test:anchor`. The IDL-drift check and `cargo test` pass locally and run in `contracts.yml`.
10. **Version choices:** ESLint 9.39, Vitest 3.2, zod 4, Sentry 10.78, Drizzle 0.45, Prettier 3. Dependabot is configured; `@solana/kit` majors and React majors are ignored until their planned tasks.
11. **CODEOWNERS** names `@labsofaroma` (the org's only admin); switch to a team once teams exist.

### M1 status: implemented on branch `m1-design-system` (not pushed, not merged, nothing deployed)

- [x] Baseline recorded before any change (lint 0 errors / 219 warnings, typecheck clean, 94 unit + 472 prototype tests with the 16 M0 skips)
- [x] `packages/ui/tokens.css`: every `foundation.css` variable mapped (table in `packages/ui/README.md`, enforced by a test), light/dark via `data-theme` with a `prefers-color-scheme` fallback, reduced motion at token level, `themeInitScript` for no flash
- [x] Tailwind v4 (CSS-first `@theme inline`) in `packages/ui` and `apps/web`, alongside the prototype's v3 (decision 2)
- [x] 23 primitives, `Brand`/`OrbitArt`, `AssetAvatar`, `Change`, `SocialLinks`; generated `logos.ts` with a staleness test
- [x] Ladle workbench: 100 stories (93 component, 7 Foundations), light and dark
- [x] Accessibility gate: token contrast test, axe in jsdom per component, axe over every story in light and dark (Chromium), keyboard and reduced-motion suites
- [x] `@aroma/ui` wired into `apps/web` (`transpilePackages`, `(app)` layout, gated `/ui-preview` route); ESLint boundary rule
- [x] Docs: `packages/ui/README.md`, `UI-SOURCES.md`, `.21st/DESIGN.md` token pointer
- [ ] **Open:** the `ui-a11y` job in `ci.yml` is authored but has never run on GitHub (needs a push). Hover styles are not covered by stories (not statically renderable); they are plain token color changes.

**Decisions**

1. **Ladle, not Storybook.** Vite-native, React 18/19, one small dependency, whole workbench builds in about 2s, so a 100-story axe run stays fast.
2. **Tailwind v3 and v4 coexist, additively, routed by file.** Next accepts PostCSS plugins only as strings, and `@tailwindcss/postcss` would inline the prototype's `@import` chain and fail on `@tailwind base`, so `apps/web/postcss/tailwind-router.cjs` runs v3 on every stylesheet except `*.v4.css` (v4 only). The v4 entry is `app/aroma-ui.v4.css`, imported only by the `(app)` layout. In the app it skips preflight and uses unlayered utilities, because the prototype's global rules are unlayered and would beat layered utilities. Proof: the four prototype CSS bundles are byte-identical before and after (same content hashes). v3 `content` excludes the new groups. M7: delete the router, use `@tailwindcss/postcss` alone, drop v3. No need to ask: it was achievable additively.
3. **`@aroma/ui` never imports Next.** `Brand` takes `LinkComponent`, `AssetAvatar` takes `ImageComponent` (the app passes `next/link` and a `next/image` adapter). The boundary lint also forbids `next`, app code, `server-only`, wallet and Solana packages.
4. **`logos.ts` is generated** from the existing `public/company-logos/manifest.json` (which already holds the mints and provenance) and the generator fails on missing files, orphan files and duplicate mints. The prototype's `lib/company-logos.ts` stays until M7.
5. **Controls have two line colors.** `--aroma-line` stays decorative (1.2 to 1.6:1); a new `--aroma-border-strong` (3:1+) marks control boundaries. Pairs used by components are contrast-tested in both themes.
6. **The `/ui-preview` route is gated by `AROMA_V1_ENABLED`** (M0 decision 1) and is `force-dynamic`, so the deployed prototype returns 404 there.

**Deviations and findings**

1. **Real defects found by the gate and fixed**: light `down` on `down-soft` was 4.48:1 (token tint lightened); `SocialLinks` aria-labels did not contain the visible text (WCAG 2.5.3; now visible text plus an `sr-only` suffix); an empty Select produced an empty `listbox` (now an inert option); the searchable Select popup had no accessible name; and **`--aroma-font-sans` referenced `--font-sans`, which `theme.css` maps back, a custom-property cycle that silently dropped Manrope** (caught by looking at a screenshot, now covered by a unit and a browser test).
2. **Prototype bug noticed, not fixed:** `tailwind.config.js` maps `raised` to `var(--bg-raised)`, which does not exist, so `bg-raised` is transparent in the prototype. The prototype's `#f59e0b` warning color also fails AA on light; the new `--aroma-warning` is darker there.
3. **jsdom cannot prove everything.** Tab-cycle focus traps and Enter-to-select in Base UI popups are asserted in Chromium (`e2e/keyboard.spec.ts`); jsdom tests cover roles, names, arrow keys and click selection.
4. **axe rules off, with reasons in the files:** page-level `region`, `landmark-one-main`, `page-has-heading-one` (a story is a fixture, not a page) and, in jsdom only, `color-contrast` (covered by the token test and the browser run). Nothing else is suppressed.
5. **`LegalPage` deferred to M3**: it reads `lib/site`, links app routes and hard-codes a date. `SocialLinks` and `OrbitArt` were ported.
6. **Select** drops the per-instance color and duration props (tokens replace them) and has a simplified API; the sliding highlight stays as a CSS Module. Type sizes are rem (the same px at default zoom).
7. **Base UI quirks accepted:** the toast close button is `aria-hidden` until the toast has focus; the tooltip popup has no `role`, so the wrapper adds `role="tooltip"` and the docs say the trigger needs its own accessible name.
8. **`AGENTS.md` still says design tokens live in `apps/web/styles/foundation.css`.** True for the prototype until M7; not edited here (outside M1's docs scope). Suggest one added line pointing new code at `packages/ui/tokens.css`.
9. **New dependencies** (all dev unless noted): `@base-ui/react` and `lucide-react` (same versions as the prototype) in `packages/ui`; `tailwindcss` 4, `@tailwindcss/vite`, `@ladle/react`, `vite`, `@vitejs/plugin-react`, `jsdom`, Testing Library, `vitest-axe`, `@playwright/test`, `@axe-core/playwright`, `tsx`, `eslint-plugin-react-hooks`; `tailwindcss-v4` (alias) and `@tailwindcss/postcss` in `apps/web`. Playwright's Chromium is downloaded on demand.

### M2 status: implemented on branch `m2-shared-helpers` (not pushed, not merged, nothing deployed)

Exit criteria (§7): **one `@solana/kit` version** (7.1.1), **no `any` in public types** (0 exported, 0 explicit in `lib/sdk`), **≥ 85% coverage** on the ported modules (97.5% lines, 90% branches, enforced: `vitest run --coverage` fails below 85/85/85/80). `apps/web/lib/sdk/sdk-rules.test.ts` fails the build if a second kit, an explicit `any`, a ported file over 400 lines, or a server/app import comes back.

- [x] Baseline and `scripts/sdk-inventory.ts`; one kit version; unused Solana packages removed
- [x] `core/` (amounts, errors, mint-precision), `pyth/` (types, feeds, hermes, solana, streaming, xstocks), `jupiter/` (price, instruction, route-plan, simulate, IDL), `markets/` (types, parse, http, zod schemas, definitions, baskets, catalog, sources/{xstocks, prestocks, backpack}), `research/` (types, http, bars, fundamentals, company, cache, service, client, pulse), `baskets/` (performance/*, custom/*, atomic-swap, bundle, liquidity, liquidity-audit, route-health, transaction-limits, mainnet, rebalance, creator), `paper/` (types, account, orders, swap, basket, valuation, plans), `trade/` (types, tokens, execution, catalogs, holdings)
- [x] 31 prototype test files moved to Vitest next to their modules (48 Vitest files now live in `lib/sdk`, 52 legacy test files remain for the unported layers and the server) (`scripts/node-test-to-vitest.ts`); new tests for amounts, Hermes, Jupiter price, schemas, PreStocks, weights, share codes, performance history and trade execution
- [x] `tsconfig.strict.json` (with `noUncheckedIndexedAccess`) covers the sources of every ported module
- [ ] **Open, by plan:** `client/*`, `state/*`, `portfolio/*` (replaced by feature `queries.ts` + TanStack Query from M3), `guard/*`, `subscriptions/*`, `recurring-investing.ts`, `devnet-xstocks.ts` (rewritten against the v1 contract in M6) stay in `lib/sdk` untouched and outside the coverage gate. They hold the only files over 400 lines besides the generated IDLs (`client/aroma-client.ts` 955, `guard/devnet.ts` 755)

**Decisions**

1. **Kit 7.1.1, not 8.3.** 7.1.1 already builds and encodes v1 transactions at runtime (the tests pass unchanged) and `@solana/subscriptions` requires `^7`; only its published types stop at legacy/0. `baskets/mainnet.ts` has one documented shim (`createV1Message` and narrow casts). Remove it when kit's types catch up.
2. **Meteora dropped** (§5.1): no route used it. `wallet-capabilities.ts` was kept even though §5.1 says drop, because the prototype's wallet components import `advertisedSigningVersions`; delete it at M7. `mobile-signer.ts` had no users and is gone.
3. **zod at the provider boundary, not strict everywhere.** xStocks, PreStocks and Jupiter payload items go through schemas whose field semantics match the old readers (a malformed field becomes missing data, never an exception); envelope checks still fail closed.
4. **Coverage gate is scoped to the ported modules** and the thresholds are global over them, so one file can sit below 85% while the whole stays above. Lowest ported files by branch coverage: `baskets/custom/resolve.ts` 67%, `validate.ts` 73%, `jupiter/simulate.ts` 78%.
5. **Tests converted mechanically from untyped `.cjs`** have partial-object fixtures that do not type-check. `tsconfig.legacy-tests.json` (strictNullChecks and noImplicitAny off) checks the 6 that pass; 8 more are excluded from `tsc` (still linted and run): `baskets/custom/custom.test.ts`, `baskets/{liquidity,mainnet}.test.ts`, `baskets/performance/performance.test.ts`, `paper/{paper,swap}.test.ts`, `trade/{catalogs,holdings}.test.ts`. They were never type-checked before either. Typing them is debt, not a regression.

**Deviations and findings**

1. **Defects found by the new tests, before they shipped:** the first zod port would have thrown on an xStocks node with no `deployments` and on array input (it would have failed a whole catalog page); the history test showed the code correctly never back-fills before a constituent's first bar (my first expectation was wrong, the code was right).
2. **A real type gap an `any` was hiding:** `underlyingPriceSource` was typed without `jupiter-stock-data` and `prestocks-issuer`, which can flow into it. The field type now matches the sources a `MarketAsset` can carry.
3. **Formatting changed file sizes:** `paper.ts` was 207 dense lines and became 630 when formatted, so it was split. Check size after Prettier.
4. **Baseline correction:** the first `any` count (137) was a bug in my script (it read value types of type symbols); the true figure was 2 explicit keywords, 0 exported.
5. **Not verified here:** CI (nothing pushed), the prototype in a browser (build and tests only). The PGlite database test (M0) timed out its setup hook under the larger parallel suite; `hookTimeout` is now 30 s.

### M3 status: implemented on branch `m3-read-only-app`, rebased onto `m2-shared-helpers` (not pushed, not merged, nothing deployed)

Exit criteria (§7): **Lighthouse ≥ 90** on performance, SEO and accessibility, and the **PRODUCT.md data rules** met.

| Lighthouse 12.8, mobile profile, local `next start` | Performance | Accessibility | SEO |
|---|---|---|---|
| `/v1` | 95 | 100 | 100 |
| `/v1/markets` | 91 | 100 | 92 (100 with a crawler UA) |
| `/v1/stock/AAPLx` | **88** | 100 | 100 |

First-load JS: `/v1/markets` **147 kB** (budget 180 kB), `/v1/stock/[symbol]` 165 kB, `/v1` 111 kB, baskets 110 kB.

- [x] Baseline before any change: lint 0 errors / 179 warnings, typecheck clean, 265 Vitest + 382 node:test (366 pass, 16 skipped). Nothing red from M2.
- [x] `features/{shared,marketing,markets,stock,baskets,watchlist}`, each with `components/`, `server.ts` (`server-only`, reads through `lib/sdk` and `apps/web/server`), `schema.ts` (zod) and tests. Strict tsconfig covers `features/**` and `e2e/**`.
- [x] Data layer: RSC pages call `features/*/server.ts`. The Next Data Cache (`unstable_cache`, tags `v1:markets` and `v1:research[:mint]`) with ISR on the pages; `POST /api/v1/revalidate` (bearer `AROMA_REVALIDATE_SECRET`, allow-listed tags) calls `revalidateTag`. No disk cache. Errors go through `mapError`; pages only ever see `{ code, message }`.
- [x] Pages: `/v1` (ISR, dated market snapshot, GSAP in a lazy island), `/v1/privacy` and `/v1/terms` (static; `LegalPage` ported), `/v1/markets` (URL filters through a plain GET form, `PulseStrip`, `MarketTable`, `MarketFilters`, `CatalogSourceBadge`), `/v1/stock/[symbol]` (ISR, `StockHeader`, lazy `PriceChart`, `ResearchTabs`, `NewsList`, disabled "Trade (coming soon)"), `/v1/baskets` and `/v1/basket/[id]` (`BasketHeader`, `AllocationTable`, streamed performance view), `/v1/watchlist` (persisted Zustand store of mints, rows rendered on the server from `?m=`). Every page has `loading.tsx` and `error.tsx`; stock and basket have `not-found.tsx` and real 404 statuses.
- [x] SEO: `generateMetadata` or `metadata` on every page with canonical URLs, `GET /v1/og.png` (AUDIT L-2 for v1), v1 sitemap and robots entries only when the flag is on.
- [x] Tests: 103 Vitest tests in `features/` (server modules 95–100% lines; happy path, stale data, missing data and upstream error mapping for each `server.ts`; component tests for `PriceChart`, `StaleBadge`, `WatchToggle`, `WatchlistSync`, and the store). Playwright (`pnpm --filter @aroma/web test:e2e`, local only): 28 tests, every v1 page in light and dark with **zero axe violations** (WCAG 2.0/2.1/2.2 A/AA + best practice, nothing disabled), forced stale (browser clock) and forced unavailable (outage server) states, the watchlist round trip, 404s, OG image and sitemap.
- [x] `pnpm build:web` passes with the flag unset (every `/v1/*` route, `/v1/og.png` and `/api/v1/revalidate` return 404; prototype routes 200; no `/v1` in the sitemap) and with it set.
- [ ] **Open:** stock detail Performance 88 (see finding 1). The Playwright suite and Lighthouse are not in CI yet (they need live providers; author an `e2e.yml` with recorded fixtures in M4). `GET /api/v1/markets` and `/api/v1/research/:symbol` (§5.4, for public or mobile use) are not built: no consumer yet. TanStack Query `queries.ts` files are not needed by read-only pages; they arrive with the first client-side refetch (M4).

**Decisions**

1. **Route collision: a temporary `/v1` prefix.** The prototype owns `/`, `/markets`, `/stock/[symbol]`, `/baskets`, … until M7, so v1 pages live at `/v1/...` inside the `(app)` and `(marketing)` groups (`app/(app)/v1/*`, `app/(marketing)/v1/*`) and are gated by `AROMA_V1_ENABLED` like `/ui-preview`: `assertV1Enabled()` in every v1 layout **and** page, because Next renders them in parallel. Links are built from `features/shared/routes.ts`. **M7:** move the folders up one level, delete the gate and change `V1` in `routes.ts` to `""`. Static v1 pages are prerendered with the flag value at build time, so turning the flag on needs a rebuild, consistent with the env check at build.
2. **Amounts.** Providers publish prices as JSON numbers. `features/shared/fixed.ts` converts each once, at the zod boundary, to `{ raw: string, decimals }` (JSON-safe for the data cache) and formats through `@aroma/ui/format` from `bigint`. Weights stay integer basis points from `lib/sdk`. Nothing in M3 signs anything.
3. **Freshness is decided twice.** The server labels each figure fresh, stale or unavailable from its own observation time, and a small client island (`StaleBadge`) re-checks at view time. A page served from cache, or left open, therefore never looks fresher than its data. Thresholds live in `features/shared/freshness.ts` (token price 10 min, snapshot 15 min, reference quote 1 h, research 6 h).
4. **Outages are never cached.** The cached loaders throw on an unusable result, so `unstable_cache` keeps serving the last good entry with its original timestamp (labelled stale), and pages render an explicit unavailable notice when there is nothing at all. `AROMA_V1_SIMULATE_UPSTREAM_OUTAGE=true` (a local test switch outside the env schema; it can only remove data) makes every provider call fail and bypasses the cache.
5. **Basket performance is labelled hypothetical**: the published weights over observed daily closes of the underlying shares, percentages only (no "$1,000 became $X"), and the sdk receives identity and weights only, so token prices never mix into the share series (M3-SDK-REQUESTS #2, #3). It streams behind its own Suspense boundary, so allocations never wait on history.
6. **Watchlist** stores mints (symbols repeat across issuers) under `aroma.v1.watchlist`, imports the prototype's `aroma.watchlist.mainnet.v1` once without writing it, validates stored data, and treats blocked storage as empty. Rows come from the server through `?m=`; the island only mirrors the saved list into the URL.
7. **`@aroma/ui` barrel.** `experimental.optimizePackageImports: ["@aroma/ui"]` in `next.config.mjs`. Without it every page shipped every client primitive (Select, Dialog, Toast …): `/v1/markets` was 267 kB, now 147 kB, and `/ui-preview` dropped from 240 to 120 kB. Prototype first-load sizes are byte-identical.
8. **OG image as a route handler, not `opengraph-image.tsx`.** Inside a route group Next serves that file at a hashed URL, and both v1 groups resolve to `/v1`, so the `(app)` pages could not reference it. `/v1/og.png` is stable and generated, with no market figures.
9. **404 decided in segment layouts.** `notFound()` inside a page that streams (because of `loading.tsx`) is sent with status 200. `stock/[symbol]/layout.tsx` and `basket/[id]/layout.tsx` look the id up in the cached snapshot first, so unknown ids get a real 404. An outage is not a 404.

**Deviations and findings**

1. **Stock detail Performance is 88, not ≥ 90.** Its largest paint is the prototype consent banner, which the root layout renders client-side after its bundle hydrates, and that bundle carries `@solana/web3.js` (`/layout` chunks 3370 and 2c344fa8, about 87 kB). The v1 content paints at FCP 1.7 s; LCP is 3.8 s. Fixing it means replacing the prototype root providers, which is M4's `features/wallet` and M7's root layout, not M3.
2. **Prototype root code made v1 pages slow and inaccessible**, fixed by two path-scoped edits that leave prototype routes unchanged:
   - `AromaProvider` polled the prototype `/api/markets` (about 2 MB of JSON) on every route, costing about 13 s of render delay under mobile throttling. `app/providers.tsx` skips it on `/v1/*`.
   - `PrivacyChoices` rendered a second `<footer>` (duplicate contentinfo landmark) whose social links failed `label-content-name-mismatch`. It now skips its footer on `/v1/*`, as it already did on the landing page; consent state, the banner and analytics are unchanged, and the v1 footer has a Privacy choices button that sends the same event.
3. **Lighthouse SEO caveats.**
   - On localhost the prototype `robots.ts` disallows everything, so the SEO run used a build with `AROMA_SITE_URL=https://www.example.com`.
   - `/v1/markets` scores 92 because Next 15 streams metadata into the body for non-bot user agents, and Lighthouse 12.8 no longer identifies as a bot. With `Chrome-Lighthouse` in the UA (Next's default bot list), the description is in `<head>` and SEO is 100. Googlebot is served the head version.
4. **Keyless Jupiter rate limits a full refresh**, about 1,600 mints: during this session only 25–33 listings had a token price. The pages show it truthfully (warnings panel, "No token price", Unavailable badges). Production needs `JUPITER_API_KEY` (M3-SDK-REQUESTS #4).
5. **Screenshots looked at** (markets light, dark, stale and unavailable; stock light, dark-stale and mobile; basket light and unavailable; landing light and dark-mobile). They led to three fixes: unobserved prices rendered at figure size, the stock `h1` wrapping badly on phones, and "1 assets".
6. **Shared files edited:** `apps/web/package.json`, `pnpm-lock.yaml` (18 lines, versions already present), `tsconfig.strict.json`, `vitest.config.ts`, `next.config.mjs`, `app/aroma-ui.v4.css`, `server/env.schema.ts`, `.env.example`, `app/sitemap.ts`, `app/robots.ts`, `app/providers.tsx`, `components/aroma/PrivacyChoices.tsx`. No `lib/sdk` edits (`git diff m2-shared-helpers --stat -- apps/web/lib/sdk` is empty).
7. **Not verified:** CI (files only, nothing pushed); the prototype in a browser (build, tests and route status codes only); Lighthouse on a deployed host.

### M4 status: implemented on branch `m4-wallet-trading`, cut from `m3-read-only-app` (not pushed, not merged, nothing deployed)

Exit criteria (§7): **a Playwright test buys on a mainnet fork or simulator**, **ported authorization tests pass**, **rate limits and CSP nonces live**.

| Lighthouse 12.8.2, mobile profile, local `next start` (flag on, placeholder env) | Performance | Accessibility | SEO |
|---|---|---|---|
| `/v1` | 97 | 100 | 91 |
| `/v1/markets` | 94 | 100 | 92 |
| `/v1/stock/AAPLx` | **92** (M3: 88) | 100 | 92 |
| `/v1/portfolio` | 97 | 100 | 91 |

SEO is 91–92 rather than 100 for the M3 reason (Next 15 streams metadata into the body for non-bot user agents; `/v1/portfolio` is also `noindex` on purpose). The first `/v1/stock/AAPLx` run errored on the document request and the rerun gave the score above.

First-load JS: `/v1/markets` **148 kB** (budget 180 kB), `/v1/stock/[symbol]` 190 kB (trade island, TanStack Query and the quote schema; the wallet stack is not in first load), `/v1/portfolio` 150 kB, `/v1` 111 kB.

Part A (fixes to M0–M3):
- [x] A1: the stock and basket segment layouts call `assertV1Enabled()` before reading the snapshot (`features/shared/layout-gate.test.ts`; it fails without the fix).
- [x] A2: `AROMA_V1_SIMULATE_UPSTREAM_OUTAGE` has no effect in production unless a local `next start` sets `AROMA_V1_ALLOW_TEST_SWITCHES=true`, which the schema rejects when `VERCEL_ENV=production`. It logs a warning whenever it is set (`features/shared/upstream.test.ts`).
- [x] A3: M3-SDK-REQUESTS #2, #3 and #4 are resolved in `lib/sdk` and the M3 workarounds are removed (details in that doc).
- [x] A4: the 8 converted test files M2 left outside `tsc` are typed and checked by the full strict `tsconfig.json`.
- [x] A5: jsdom canvas errors are silenced by a 2D-context stub in `@aroma/ui`'s test setup (0 occurrences; console is not muted).
- [x] A6: AUDIT M-12 now records the real state. AGENTS.md points new code at `packages/ui/tokens.css`.

Part B:
- [x] B1: React **19.2.9** and types 19.2 in `apps/web` and `packages/ui`, one React in the lockfile. Peer ranges checked: Privy `^18 || ^19`, wallet-adapter `*`, Base UI `^19`, Ladle `>=18`, Next `^19.0.0`. The Ladle gate is 312/312 (axe over every story, light and dark, plus the keyboard and reduced-motion suites).
- [x] B2: `features/wallet`.
  - The context is key-free: `useSigner`/`useWallet` turn unsigned base64 into signed base64.
  - `WalletBoundary` loads the stack only on connect, or after first paint when restoring a session.
  - The stack is wallet-adapter (Wallet Standard raw-byte signing for V0 and V1; web3.js only here, for the legacy V0 fallback) plus Privy embedded wallets when an app id is set.
  - The picker is built from `packages/ui`.
  - Mainnet only: the browser RPC must report the mainnet genesis, and devnet-only accounts are refused.
  - v1 has its own root layouts (decision 1).
- [x] B3: `server/auth/trade.ts` and `trade-transactions.ts`. The prototype trading, bundle-authorization and composed-transaction suites were ported (10 tests), plus fast-check properties (6).
- [x] B4: `features/trade/server/*`. The prototype suites were ported first (jupiter-intermediate-accounts 45 cases, lookup tables, Jito, single-execution recovery, V1 gating, order-precision target checks), then the modules written. Every built transaction is simulated before it is returned.
- [x] B5: `POST /api/v1/trade/quote`, `POST /api/v1/trade/submit`, `GET /api/v1/trade/:id`, `GET /api/v1/portfolio/:wallet` (plus `GET /api/v1/prices` for paper practice). Receipts go to the M0 table as raw-integer text, and submit is idempotent through a Redis `SET NX` on the request id.
- [x] B6: `useTradeFlow` on a pure state machine (`flow.ts`), TanStack Query v5 (`features/*/queries.ts`), `TradeTicket` on stock and basket pages, a review screen, and paper mode.
- [x] B7: `/v1/portfolio` with `HoldingsTable`, `AllocationDonut`, `PnLSummary` (no cost basis is estimated) and `ActivityList` (from receipts).
- [x] B8: Node.js middleware with Upstash read, write and trade buckets, a per-request nonce CSP on `/v1/*` and `/api/v1/*`, one HSTS header with preload, and `Origin` checks.
- [x] B9: Jupiter and Pyth health probes; redacted structured logs and Sentry breadcrumbs for every trade stage.
- [x] B10: `scripts/check-client-secrets.mjs`, run by `pnpm build:web`. The two M4-tagged skips run again.
- [x] B11: the local-fork E2E (`pnpm --filter @aroma/web e2e:fork`) and an authored `e2e.yml`.
- [ ] **Open:** see "Open items" below.

**E2E evidence.**
- **Trade suite on a local mainnet fork** (`pnpm --filter @aroma/web e2e:fork`): 9/9 pass.
  - The fork was solana-test-validator 3.1.10 with `--clone-feature-set`, warped to the current mainnet slot, with 10 programs and 459 accounts cloned from mainnet.
  - Stock buy of AAPLx (1 USDC) and basket `sol-core` (3 legs, one transaction, 2 USDC) were each quoted, reviewed, signed by the test wallet, submitted and confirmed on the fork.
  - Also passing: portfolio and activity, tampered authorization 403, expired quote 410, trade-bucket 429, paper trade, and axe light and dark on `/v1/portfolio`, `/v1/stock`, `/v1/basket` and the review screen.
  - **No mainnet transaction was sent.**
  - Baskets with a Manifest-only leg (JPMx, LMTx, HONx today) are skipped because Agave 3.1.10 cannot execute Manifest's current binary. XOMx is currently paused by its issuer.
- **M3 smoke suite** (`pnpm --filter @aroma/web test:e2e`): 28/28, zero axe violations in light and dark, outage states included.
- **Ladle gate:** 312/312.

**Decisions**

1. **Three root layouts.** The prototype pages moved to `app/(prototype)` (URLs unchanged). `(app)` and `(marketing)` are roots of their own, so `/v1` loads none of the prototype's providers, global CSS, consent footer or `@solana/web3.js` (M3 finding 1). Unmatched URLs use `global-not-found` with the prototype's 404. Moving between the prototype and v1 is a full page load. **M7:** delete `(prototype)`.
2. **v1 HTML is dynamic.** A nonce CSP needs a nonce per request, so v1 pages are no longer ISR. Market and research data still come from the Next data cache, so pages stay fast (TTFB about 20 ms warm). The legal pages are `force-dynamic` for the same reason: a prerendered page would carry no nonce and its scripts would be blocked.
3. **One authorization token for single transactions and bundles:** `at1.<kid>.<payload>.<mac>`, with a zod-strict payload. The key id enables rotation through `AROMA_TRADE_SECRET_PREVIOUS`. Bundle-status capabilities are replaced by a server-side trade record keyed by the request id (idempotency and status in one place).
4. **Funding is USDC, USDT or SOL; targets are catalog rows.** Only verified, unhalted rows with their issuer catalog present can be traded, so discovery-only listings cannot be. A live basket needs every constituent listed, verified and unpaused, but no catalog token price: the Jupiter quote and the mainnet simulation price the order (keyless catalogs leave most mints unpriced).
5. **Bundles only when configured.** A basket that needs more than one transaction is refused (`BUNDLE_UNAVAILABLE`, no partial order) unless `JITO_BLOCK_ENGINE_URL` is set. Jito rejection or ambiguity is never retried as individual transactions.
6. **Receipts:** one `receipts` row per transaction signature. `basket_id` stays null because curated baskets are not in the `baskets` table; the slug and request id are on each leg. Status moves pending → confirmed | failed and never back.
7. **Fees shown are what the transaction encodes:** 5,000 lamports per signature, the priority fee from compute-budget instructions ("not reported" for V1 headers it cannot read), the Jito tip, and a platform fee of 0. Amounts on the review screen use exact precision, so a minimum received is never rounded up.
8. **The E2E wallet holds no key.** Builds with `NEXT_PUBLIC_AROMA_E2E_WALLET=true` include a bridge to `window.aromaE2EWallet`, which Playwright exposes from Node test code holding a deterministic keypair. `next.config` always inlines the flag, so production builds drop the import. The secret scan fails any build that contains the marker.
9. **Middleware runs on the Node.js runtime** (stable in Next 15.5) so it can use pino and Upstash. The prototype's `{ error }` bodies are unchanged; v1 gets `{ code, message }`.

**Deviations and findings**

1. **Real defects found by the new tests and checks, all fixed:**
   - zod 4 runs `.refine` after a failed regex, so `BigInt()` threw on input like `:` (found by a fast-check property);
   - the E2E wallet chunk was emitted into production builds (found by the secret scan);
   - `assertSameOrigin` compared `Origin` with `request.url`, which `next start` rewrites to localhost, so same-site POSTs got 403 (found by the fork E2E);
   - middleware judged "loopback" from the server's bind address, so no HSTS was sent behind a proxy (found by the header dump);
   - static legal pages carried no nonce;
   - v1 depended on prototype CSS for its resets and fonts, so buttons fell back to the browser's grey and failed dark-mode contrast (found by the M3 smoke suite);
   - Hermes needs a key, so an unconfigured Pyth probe is now `skipped`;
   - a fork without `--warp-slot` cannot use cloned lookup tables.
2. **Prototype behaviour changed on purpose:**
   - basket history is history-only for the prototype too (A3);
   - one HSTS header with preload on every HTTPS response;
   - Upstash rate limiting for prototype API routes (same 120/20 limits, plus a trade bucket of 10);
   - the prototype's CSP is scoped to non-v1 paths, otherwise unchanged.
3. **Prototype files edited:** the moved `app/(prototype)/**` files (imports only); `tests/wallet-provider-routes.test.ts` (path); `tests/request-policy.test.mjs`, `tests/bundle-api.test.ts` and `tests/basket-buy-actions.test.ts` (their 7 middleware cases moved to `server/middleware.test.ts`); `tests/client-secret-scan.test.mjs` and `tests/secrets-configuration.test.mjs` (comments only); `middleware.ts` (rewritten); `next.config.mjs`.
4. **Shared helpers edited (allowed after M2):**
   - `lib/sdk/baskets/performance/{history,growth,returns}.ts`, `lib/sdk/baskets/liquidity.ts` (parameter type), `lib/sdk/markets/{http,catalog}.ts`;
   - new `lib/sdk/markets/test-fixtures.ts`;
   - `server/{errors,env.schema,http,health}.ts`, `packages/ui/src/test/setup.ts`, `packages/ui/e2e/stories.ts`, `packages/config/eslint/index.js`.
5. **Prototype tests:** the legacy runner has 7 fewer tests (moved to Vitest, same assertions) and 2 fewer skips (restored). Skips left: 14, all M6 or post-v1 mobile, as listed under M0.

**Open items**
- Real mainnet: not verified (see `docs/M4-DEPLOY.md` §4). No transaction with real funds was signed or sent.
- CI: not verified. `ci.yml` and `e2e.yml` are files only.
- Upstash rate limits and Redis idempotency against a live instance; receipts in Neon.
- Prototype CSP tightening (AUDIT H-6 residue, M7); prototype `/api` routes still return `error.message` (M-5 residue).
- web3.js v1 server-side in `lib/sdk` and `server/rpc.ts` (AUDIT M-12 residue).
- Custom and creator baskets (M5): the trade server supports catalog baskets only.

### M5 status: implemented on branch `m5-creators`, rebased onto `m4-wallet-trading` (not pushed, not merged, nothing deployed)

Exit criteria (§7): **creator E2E**; **single-use invites enforced**. M5 was built in two parts: **M5a** (no wallet; below, as recorded before the rebase) on `m3-read-only-app`, and **M5b** after rebasing onto M4. Everything M5a needed from M4 is resolved ([M5-NEEDS-FROM-M4.md](./M5-NEEDS-FROM-M4.md)). The pre-rebase branch is kept locally as `m5a-backup`.

**Step 0.** Baselines before the rebase, both green: `m5-creators` (typecheck, lint 0 errors / 143 warnings, format, 617 Vitest + 296 node:test with 280 pass / 16 skip, both builds) and `m4-wallet-trading` in a temporary worktree (lint 0 / 141, 672 Vitest + 289 node:test with 275 / 14, both builds). The rebase had one conflict, the expected one in this file (both status sections kept). After the rebase everything passed; typecheck first failed only on stale `.next/types` from the pre-rebase build (old `app/page.tsx` paths, which M4 moved to `(prototype)`) and passed once `.next` was regenerated. Nothing red came from either milestone.

**Part A (fixes found in review)**
- [x] A1: `/v1/basket/new` exported `revalidate = 120`; now `force-dynamic` (M4 decision 2). The build already listed it as dynamic, because the `(app)` root layout calls `headers()` for the nonce, so the export was a latent trap, not a live breakage. `features/shared/v1-dynamic.test.ts` fails any v1 page or route that exports `revalidate`, `generateStaticParams` or `force-static` (the OG image is the one allowed static route). A Playwright test checks the nonce CSP header, that every script carries that nonce, a fresh nonce per request, and that the builder hydrates.
- [x] A2: the per-handler `assertSameOrigin` (with the `request.url` fallback M4 fixed in middleware) is deleted; middleware's allowlist applies. The challenge's `Site:` line uses middleware's `requestProtocol`/`requestHost`. `server/middleware.creators.test.ts`: cross-site POST/DELETE to each creator route is 403 `ORIGIN_FORBIDDEN`; same-site under `next start` (proxy and 127.0.0.1) is accepted.
- [x] A3: handler limiters and the shared `"local"` key are deleted. New middleware `creator` bucket (10/min) for challenge issuance and invite redemption; other creator mutations stay in `write`. Tests in `server/request-guard.test.ts` and `server/middleware.creators.test.ts`.
- [x] A4: every client call (`features/creators/api.ts`) sends JSON with `Content-Type: application/json`, DELETE included (tested). Middleware: 415 without it on each creator route, a maximal 20-allocation payload passes the 16 KiB cap (under 8 KiB), 413 above it. Handlers: the largest valid basket publishes; a 20-allocation body is a 400 schema refusal, not a 413.
- [x] A5: the property tests run on `fast-check` (`fc.assert(fc.asyncProperty(...))`, same 7 properties, 200 runs each).
- [x] A6: `check-client-secrets` passes on the rebased production builds (flag off and on): `OK … E2E markers forbidden`; no E2E wallet marker or configured secret in `.next/static`.

**Part B (M5b)**
- [x] B1: `Signer.signMessage(bytes)` in `features/wallet`: Wallet Standard `solana:signMessage`, a legacy adapter's `signMessage`, Privy `useSignMessage`; answers checked (64 bytes, and a wallet that signed different bytes is refused); wallets that cannot sign messages get a clear message. The E2E bridge signs messages in test builds only.
- [x] B2: `PublishPanel` in the builder: connect → redeem the invite (first time) → challenge → sign → submit, with explicit steps and no optimistic state (TanStack Query mutations in `features/creators/queries.ts`). `?from=<id>` pre-fills a published basket to publish its next version. Creator baskets render at `/v1/basket/[id]` (UUID ids; curated slugs unchanged) with provenance, allocation, hypothetical performance, purchases and the M4 trade ticket; the creator wallet sees "Publish a new version" and "Archive" (confirmation dialog). Directory cards link there; nav has **Creators**.
- [x] B3: the trade server quotes and sells PUBLISHED creator baskets with the curated rules (every constituent listed, verified and unpaused; weights from `basket_allocations`; simulation before return; no partial order); archived is refused. `receipts.basket_id` is set for creator baskets (curated stays null, M4 decision 6) and every leg carries `basketVersion`. Migration `0002_basket_versions`: insert-only history (triggers refuse UPDATE/DELETE/TRUNCATE), PGlite tests.
- [x] B4: `features/baskets/actions.ts` on M4's `quoteTrade`: `GET/POST /api/v1/actions/baskets/:id` and a `links.next` confirm callback that records the receipt only after reading the transaction back from mainnet and matching the authorized message hash, fee payer, wallet and signature. Gated by the flag; `actions.json` adds `/v1/basket/*` only while it is on; middleware gives `/api/v1/actions/*` the Action CORS and chain headers and the trade bucket. The prototype `/api/actions/*` is untouched. M7 path switch: [M4-DEPLOY.md §5.4](./M4-DEPLOY.md).
- [x] B5: `features/creators/stats.ts`: purchases (orders), unique buyers and raw volume per funding mint from **confirmed** receipts only, over 7 days, 30 days and all time, with source and as-of. No confirmed purchase is "No purchases yet", never 0; an outage is "unavailable".
- [x] B6: `apps/web/scripts/local-db.sh` (`pnpm --filter @aroma/web db:local up|reset|down|env`): Docker Postgres 17 + Neon's wsproxy, migrations through the production driver. `server/db/local-neon.ts` applies only to a loopback `DATABASE_URL` with `AROMA_LOCAL_NEON_WS_PROXY`, never in Vercel production. No Neon account was created.
- [x] B7: creator E2E on the local fork (below).

**Evidence (all local; CI not verified, files only)**
- `pnpm typecheck` clean; `pnpm lint` **0 errors** (141 warnings, all pre-existing prototype/`lib/sdk`); `pnpm format:check` clean.
- `pnpm test`: web Vitest **959 passed, 1 skipped** (`invites.postgres.test.ts`, which needs the local Postgres and passes against it); node:test 289 (275 pass, 14 skipped: M4's M6/mobile skips, unchanged); `@aroma/ui` 210, config 2, keeper 1.
- Coverage (all gates hold): overall lines 95.3%; `lib/sdk/*` 94.5–100%; `server/auth/creator.ts` **98.9%** lines / 92.3% branches; `features/creators/server.ts` **97.9%** / 94.7%; `stats.ts` 100% / 78.9%; `features/baskets/actions.ts` 95.5% / 90.9%. The creator and Actions server modules not named `server.ts` are now in the gated set.
- `pnpm build:web` passes with the flag off (every new page and API route is 404, POST included; `/`, `/markets`, `/baskets`, `/basket/builder`, `/creators` are 200; `actions.json` lists only the prototype rules) and with `.env.example` and the flag on. Secret scan OK on both.
- `next start` header dump on `/v1/basket/new`: `Content-Security-Policy … script-src 'self' 'nonce-…' 'strict-dynamic'` (no `'unsafe-inline'` scripts), `Cache-Control: private, no-cache, no-store`; all 35 scripts carry the response's nonce.
- **Fork E2E** (`pnpm --filter @aroma/web e2e:fork`): **18/18**: M4's 9 unchanged, plus 9 creator tests: admin CLI invite → connect → redeem → build → sign → publish; a second basket in dark mode; directory and basket page with zero axe violations in light and dark (builder too); a buy through the trade ticket and one through the v1 Action, both confirmed on the fork; stats 2 purchases, 1 buyer, 4 USDC raw; refusals (used invite 403, replayed challenge 401, another creator publishing over the basket 403, cross-site publish 403 `ORIGIN_FORBIDDEN`); archive through the dialog, after which the quote is refused as archived and the Action is 404. **No mainnet transaction was sent**; every transaction went to the fork at 127.0.0.1.
- **M3 smoke suite** (`pnpm --filter @aroma/web test:e2e`): **36/36** (M3's 28, M5a's 7, the A1 nonce/hydration test).
- **Single-use invites:** exactly one of 25 parallel redemptions succeeds on PGlite and on **real Postgres with 25 connections** through the Neon driver; the E2E refuses a used invite.

**M5b decisions**

1. **One id space for baskets.** Curated baskets are lib/sdk slugs, creator baskets are UUIDs; `/v1/basket/[id]`, `target.basketId` and the Action use the shape to pick the source. No new request field, and a slug can never be a UUID.
2. **Builder asset rule = trade rule.** Listed, verified, not halted (M4 decision 4); an observed token price is shown when there is one but no longer required (M5a decision 5 required it, which left 10–32 selectable assets on keyless Jupiter). Unpriced assets say "No token price observed".
3. **Action receipts come from a `links.next` callback** bound by the HMAC authorization and verified against the transaction read back from mainnet (15-minute grace after quote expiry, idempotent). A Blink client that never calls back is not counted.
4. **Usage windows use the order time** (`receipts.created_at`, the server clock), not the chain's block time, which can run ahead (seconds on mainnet, hours on a warped fork; found by the E2E).
5. **Local-fork E2E uses in-process creator challenges** (no Redis there), with M4's exact gate (`features/trade/server/local.ts`), and writes receipts to the local Postgres when one is configured.
6. **Volume is never converted or summed across mints**: one exact `numeric` sum of raw units per funding mint.

**M5b deviations and findings**

1. **Found and fixed by the new checks:** the usage-window bug (decision 4); `features/creators/server.ts` reached 410 lines in the `basket_versions` commit and was split in `3c092a9` (stats moved to `stats.ts`), three commits later; lint at the commits between would report it; a route test that imported `app/actions.json` pulled prototype `lib/server` into the strict tsconfig (rules moved to `features/baskets/actions-json.ts`); a server component importing a helper from a `"use client"` module; after an archive, `router.refresh()` once failed to re-render the server part (one fork run), so the page now reloads (the next fork run passed 18/18).
2. **Found in the screenshots and fixed:** the v1 footer still said "Trading is not available in this preview" (false since M4); `/v1/creators` said purchases are not recorded; "Buy the … basket basket". The consent banner is fixed bottom-right and covered the publish panel in full-page captures; the E2E now dismisses it first (it is the existing root component, not changed).
3. **Screenshots looked at** (`apps/web/test-results/m5-screens/`, regenerated by each fork run): builder empty, filled and publishing (signing spinner and "Confirm the basket in your wallet"), directory and creator basket page, in light and dark. During the runs 1,614 assets were selectable and 1,581 to 1,593 had no observed token price (keyless Jupiter, M3 finding 4); the pages say so.
4. **Shared and prototype files edited:** `middleware.ts`, `server/request-guard.ts`, `server/auth/trade.ts` (optional `basketVersion` on the receipt), `server/db/{schema,client,migrate}.ts`, `features/trade/{schema.ts,server/*}`, `features/wallet/*`, `features/shared/{routes.ts,components/NavLinks.tsx,components/SiteFooter.tsx}`, `features/baskets/components/BasketHeader.tsx`, `app/(app)/v1/basket/[id]/{layout,page}.tsx`, `app/actions.json/route.ts` (prototype rules unchanged), `e2e/fork/run.ts`, `e2e/trade/wallet.ts`, `vitest.config.ts`, `apps/web/package.json` (one script, no dependency). No other prototype file, no `lib/sdk` file, and no lockfile change.

**Open items**
- CI: **not verified**, files only. Nothing pushed.
- Real mainnet: a real wallet extension or Privy signing a creator challenge; a Blink client using the v1 Action and calling back; Upstash for challenges and the `creator` bucket; receipts and stats in Neon ([M4-DEPLOY.md §5.6](./M4-DEPLOY.md)).
- `features/creators/http.ts` is 71% lines on its own (production wiring: Upstash store, market registry); the gated aggregate passes.
- No creator reward mechanism (AUDIT §4.4); the prototype `/creators` and `CREATOR_*` env stay until M7.
- Edit-and-republish is via `?from=` in the builder; there is no creator dashboard page listing one's own drafts and archived baskets yet.

#### M5a (before the rebase; kept as recorded)

M5 is split because M4 (wallet + spot trading) was in progress in parallel. **M5a** is everything that does not need a wallet. **M5b** (wallet-signed publish, Solana Actions, receipt-based stats, the creator E2E) starts after rebasing onto M4. What M5a needs from M4 is listed in [M5-NEEDS-FROM-M4.md](./M5-NEEDS-FROM-M4.md).

- [x] Baseline before any change: typecheck clean, lint 0 errors / 143 warnings, format clean; 492 Vitest (web) + 296 node:test (280 pass, 16 skipped), `@aroma/ui` 210, config 2, keeper 1.
- [x] `server/auth/creator.ts` (port of `creator-auth.ts`; prototype tests ported first). A zod-parsed challenge payload (wallet, purpose, basket id, content hash, nonce, issued-at, expiry) behind a human-readable message. The message embeds SHA-256 of the canonical payload and content. Single-use nonces via Redis `GETDEL`. Ed25519 verification with `@solana/kit` (`verifySignature`), with no new dependency and no key on the server. Property tests (seeded PRNG, 200 cases each) cover tampering, expiry, replay, wrong wallet and wrong purpose.
- [x] Invites (AUDIT §4.4): hashed codes, always expiring (≤ 90 days), single-use by default. Redemption is one transaction: a conditional `UPDATE … uses < max_uses AND expires_at > now`, then the `creators` row with `invite_id`. `scripts/create-invite.ts` prints a code once.
- [x] `features/creators/server.ts` on Drizzle: drafts, publish (lib/sdk `validateProgrammableBasket`, then the weights trigger), versioning, archive, ownership, public reads, stats. `schema.ts` (zod) is shared by the API and UI.
- [x] API `/api/v1/creators/{challenge, invites/redeem, baskets, baskets/:id, :wallet/stats}`: thin `parse → service → mapError` handlers, 404 when the flag is off, same-origin check and rate limits in the handlers (`TODO(M5b)`: M4's middleware).
- [x] UI: `/v1/basket/new` (`BuilderForm`, `AssetPicker`, `WeightEditor`, `BuilderPreview` reusing `AllocationTable`, browser-only drafts, disabled **Publish (connect wallet)**) and `/v1/creators` (server-rendered directory). `assertV1Enabled()` in every page; the existing `(app)/v1` layout gates too.
- [x] Tests: web Vitest 492 → **617** (91 files), including PGlite service and route tests (happy path, unauthorized, expired, replay, wrong owner, invalid weights, flag off → 404, cross-origin, rate limited) and component tests for `WeightEditor` and `AssetPicker`. Playwright (local only): **35/35** (M3's 28 + 7 new; both new pages at zero axe violations in light and dark, the builder flow and blocked storage).
- [x] Coverage: `server/auth/creator.ts` 98.9% lines / 92.3% branches; `features/creators/server.ts` 98.1% / 92.0%; `invites.ts` 95.3% / 84.2%.
- [x] `pnpm build:web` passes with the flag off (every new page and route is 404; the prototype `/`, `/markets`, `/baskets`, `/basket/builder` and `/creators` are 200) and with `.env.example` placeholders and the flag on.
- [ ] **Open (M5b):** wallet-signed publish, update and archive in the UI; `features/baskets/actions.ts` (Solana Actions); receipt-based usage and volume; rate limits in M4's middleware; the creator E2E (mocked signer → redeem → build → publish → directory → buy via Action on a simulator).

**M5a decisions**

1. **Challenge state is a Redis nonce, not an HMAC token.** The prototype signed an HMAC token with `CREATOR_AUTH_SECRET` and claimed the nonce separately. In v1 the payload is stored under the nonce for 5 minutes and consumed with `GETDEL` *before* any check, so a challenge authorizes at most once even under concurrent requests. A refused attempt burns it too. No new secret is needed.
2. **A fourth purpose, `redeem`.** The plan lists `publish | update | delete`, but redeeming an invite creates a `creators` row for a wallet. It must be signed (AGENTS.md rule 2), or anyone could register someone else's wallet.
3. **Signed content is canonical JSON of the parsed body.** The wallet prompt lines are derived from that content only, never from the live catalog, so verification rebuilds the exact message.
4. **Invites without an expiry are refused** (fail closed), even though the column is nullable. All refusals share one public message; the reason (`unknown`, `expired`, `used`, `no-expiry`) goes to logs.
5. **Assets must be registered at save time.** The server takes symbols from the market snapshot (verified, not halted), never from the client. The builder additionally requires an observed token price to select an asset.
6. **No migration in M5a.** A new version overwrites the allocations and bumps `version`; earlier versions are not kept. A `basket_versions` table can follow after M4's migrations (M5-NEEDS #5). For the same reason, stats report `lastPublishedAt` but no "first published" date.
7. **Drafts on the server are private** (`GET` returns 404). The M5a builder keeps drafts in browser storage only.
8. **Creator routes live in `features/creators/routes.ts`**, and there is no nav link yet, so that `features/shared` stays untouched while M4 is in flight.

**M5a deviations and findings**

1. **`tsconfig.strict.json` did not cover `features/` or the v1 route groups.** TypeScript's `include` has no brace expansion, so `*.{ts,tsx}` matched nothing, and those files were strictly checked only when imported. Fixed (one pattern per extension); all 100 existing files pass. This is the one shared config edit.
2. **Found by the gates and fixed before commit:** `next build` rejects `void` as a route handler's second parameter (the wrapper now has overloads). An unreachable Neon database rejected with a DOM `ErrorEvent` wrapped by Drizzle and surfaced as 500; it is now 503 `SERVICE_UNAVAILABLE`. On phones, the weight rows lost their symbol labels and the builder overflowed to 596 px; found in the screenshots, now 0 px of overflow at 390 px and 1440 px.
3. **`fast-check` is not installed**, so the property tests use a seeded PRNG (M5-NEEDS #1).
4. **PGlite runs transactions one at a time.** The 25-way parallel redemption test proves the conditional-update logic and the rollback paths. Row-level locking under true parallelism is Postgres's `UPDATE … WHERE` semantics, not exercised locally. The schema's `uses <= max_uses` CHECK is the backstop and is tested.
5. **Screenshots looked at** (builder and directory, light and dark, desktop and 390 px). The directory shows its unavailable state, because there is no reachable Postgres locally (M5-NEEDS #6). Only 10 to 32 assets were selectable during the session because keyless Jupiter rate-limits token prices (M3 finding 4); the page says how many were left out and why. The prototype root "Skip to content" link appears mid-page in full-page captures; it is fixed-positioned and appears only on pages taller than the viewport (the root layout, not M5).
6. **Shared files edited:** `apps/web/tsconfig.strict.json`, `docs/REWRITE-PLAN.md`. `docs/M5-NEEDS-FROM-M4.md` is new. Nothing in the do-not-edit list was touched.
7. **Not verified:** CI (files only, nothing pushed); a real Neon database; true parallel redemption on Postgres; wallet signing in a browser (M5b).

### M6 status: done. Implemented on branch `m6-contract-core`, cut from `m5-creators` (not pushed, not merged); **deployed to devnet by the owner on 2026-11-14** (recorded on `m7-recurring-devnet`)

Exit criteria (§7): LiteSVM suite green ✓; local validator end to end ✓; **deployed to devnet by the owner ✓**; config initialized and test assets registered ✓; `devnet:audit` clean ✓ (addresses, signatures and links in [M6-DEVNET-DEPLOY.md](./M6-DEVNET-DEPLOY.md#deployed-devnet-2026-11-14)). The program is documented in [aroma-guard-v1.md](./aroma-guard-v1.md).

**Part 0 and Part A**
- [x] Part 0: §7 rewritten through M11 (launch), critical path, §9/§10, ROADMAP phase mapping, spec §9 note, AUDIT milestone tags. Reworded afterwards so v1 stands alone (owner decision during M6).
- [x] A1: `features/creators/http.ts` 71% → **100% lines** / 97% branches on its own (`http.wiring.test.ts`, mocks only, no behaviour change).
- [x] A2: the 13 `TODO(M6)` skips are retired (they imported two scripts that were never committed; one recorded a defect in the earlier devnet catalog). Disposition, one line each:

  | Retired case | Reason | Tested now by |
  |---|---|---|
  | `devnet-authority-audit.test.mjs` × 4 (genesis stop; PDA vs faucet authority; wrong authority and feature activation; bad manifest) | `scripts/audit-devnet-recurring.mjs` never existed; the feature-activation check has no counterpart | `packages/contracts/scripts/audit.test.ts` (genesis stop, PDA authorities and faucet authority, wrong authority, foreign funding mint, read-only methods) |
  | `devnet-xstocks.test.ts`: catalog uses SBUX, RTX, COP, CAT, DE, GE | the earlier devnet catalog; not used by the new devnet set | `scripts/assets.test.ts` (every devnet asset is a canonical basket constituent with its real feed) |
  | `devnet-xstocks.test.ts` × 8 (mainnet refusal, mint reuse, bigint supply, idempotent repeat, creation timeout, funding timeout, checkpoint conflict, argument parsing) | `scripts/create-devnet-xstocks.cjs` never existed | `scripts/provision.test.ts` (same eight behaviours for the new provisioning) |

  The four `devnet-xstocks.test.ts` cases that test `lib/sdk/devnet-xstocks` still run. Legacy suite: 276 = 275 pass + 1 skip (mobile only).
- [x] A3: `packages/contracts/Anchor.toml` pins `anchor_version = "1.2.1"` and `solana_version = "3.1.10"` (installed), defaults to `localnet`, wallet `~/.config/solana/aroma-deployer.json`. `packages/anchor/Anchor.toml` still pins `solana_version = "4.0.0"` (not installed here); left unchanged because nothing in M6 builds it, and it is deleted in M9.

**Part B**
- [x] B1: `packages/contracts` (`@aroma/contracts`), layout per spec §3; release `overflow-checks`, fat LTO; features `devnet-mock` and default; `anchor-lang`/`anchor-spl` 1.2.1 (`token_interface`, no `init-if-needed`); `solana-security-txt`; program keypair generated, `anchor keys sync`; root `build:contracts`, `test:contracts`; `pnpm test` runs only the contracts unit project (no SBF build).
- [x] B2: `Config` (800 B), `Asset` (190 B), `Plan` (1,079 B, `version`, 96 reserved bytes, ≤ 20 outputs, `leg_bitmap`, `skipped_periods`); sizes are constants with an `INIT_SPACE` test.
- [x] B3: all ten instructions with explicit owner, program, token-program, `has_one` and seeds/bump constraints.
- [x] B4: devnet-mock `execute_installment` (spec §6); pure math in `math.rs`. Pyth: the official `pyth-solana-receiver-sdk` 2.0.0 compiles with anchor 1.2.1 and is used.
- [x] B5: `integrations/subscriptions.rs` (typed, pinned to `program-v0.5.0`, sources cited in the file), `integrations/pyth.rs`, `integrations/jupiter.rs` (M8 stub).
- [x] B6: 25 `cargo test` (incl. 3 proptests × 2,000 cases) and 56 LiteSVM cases with the pinned binaries.
- [x] B7: Codama client in `lib/sdk/guard/v1/generated/` (renderer below), hand-written `builders`/`admin`/`execute`/`decoders`/`pdas`/`schedule`/`deployments`, drift test, `sdk-rules` exemption for `generated/` (400-line rule only).
- [x] B8: `pnpm --filter @aroma/contracts e2e:local` passes.
- [x] B9: `deploy-devnet.sh`, `init-devnet.ts`, `register-devnet-assets.ts`, `audit-devnet.ts`, all refusing non-devnet genesis; the runbook; `deployments.ts` holds `null` until the owner's deploy.
- [x] B10: `contracts.yml` v1 job (files only).
- [x] **Devnet deploy (owner, 2026-11-14).** The owner signed every step with their deployer; the agent verified each one read-only.
  - Program [`FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU`](https://explorer.solana.com/address/FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU?cluster=devnet), deploy [`2BrA49su…gGvwqeaM`](https://explorer.solana.com/tx/2BrA49sugG85LQDE8oyTMzsSfSZttcvgFv1uKiv8ercRDAk1QDXppZHxvJRwCRe55VowgJdXax2eQJqwgGvwqeaM?cluster=devnet) (slot 522,224,536). Upgrade authority = the owner's devnet deployer `4xAGiZM4st6S94f9sEHzLdyQ8k9Wj71rPrtcj8kGgoha`. On-chain bytecode SHA-256 = the local devnet-mock build (`20f629220437…31293`, 479,312 bytes, SBPF v0). No leftover buffers.
  - `initialize_config` [`2xsXwoD6…f8RjrJ`](https://explorer.solana.com/tx/2xsXwoD6NcV177QSppSqMJWvcfCcphQrGAYph72Ggaz5SQAzrQ1QHaiM61AK8jLPhJ8yJhhBAkakiH6eo9f8RjrJ?cluster=devnet): config `4RkxYfgq7vFE1BNt4b2DYy27kqh9M9eQpbEYeBx4uzox`, decoded from chain: admin and treasury = deployer, keeper `Some(7qMWtAz…oio2j)`, not paused, fee 0, window 1, slippage 300 bps, staleness 60 s, confidence 200 bps, 500 tUSD cap, funding mints = tUSD only, Token-2022 allow-lists empty. tUSD `2s5AcNQaXiC3GNCqK8Wh7XK8hE3pzB22KtQbMn8DZEZu` (classic SPL, 6 dp, no freeze, mint authority = the devnet faucet key `JBfNfBJc…nrG`).
  - `register_asset` ×3: xAAPL `3cc8Puuq…Adpc` ([`21c5jVUT…`](https://explorer.solana.com/tx/21c5jVUTb6ykKcEYFkqzcDRCtE2Ca3ZGD1RGKM2mc62qFXw5BXaALYkJ83sTQ69tjw4i3ZZNhCW43ug2VsnYJkpd?cluster=devnet)), xMSFT `3atQKQbc…Hjga` ([`8Xg2NV1N…`](https://explorer.solana.com/tx/8Xg2NV1NCWeLBmBa3S4DCUCD1dDZbfy2jMGHq9rNWQqJfwHJ92qX1YNdPtpM3ixUtjaXg5jRdb5ypzpcTa3HoQY?cluster=devnet)), xNVDA `BM4ccDkz…TAy` ([`8VzxnRCL…`](https://explorer.solana.com/tx/8VzxnRCL3dqo61quqPZ5uYwsAGbnh1asA1aMbfhuwK5aA3UKSYFUZ6NDT8K3fB1w8wwEX6Z26tJ23SSB1SdaDZM?cluster=devnet)). Decoded: Token-2022, 8 dp, ScaledUiAmount, no freeze, mint authority = each `mock_mint` PDA; each asset enabled with the real Pyth equity feed id.
  - `devnet:audit`: `"passed": true`, 11/11 checks, no issues, `"transactionsSubmitted": 0`.
  - `V1_DEPLOYMENTS.devnet` filled (`packages/guard/src/v1/deployments.ts`, with config, treasury, keeper, faucet and assets; a test re-derives every PDA and checks the feeds). `/v1/invest` and the plan and faucet routes are now live against devnet when the env is configured.

**Decisions**
1. **Product decisions applied:** keeper = a devnet-only keeper `7qMWtAz…oio2j` (`update_config` can set `None`); protocol fee 0 bps (path tested at 25 bps); catch-up window 1; test USD only on devnet (4 slots).
2. **Token-2022 policy, amended by the owner after the evidence.** All 40 catalog xStocks (mainnet, read-only) have a permanent delegate, the confidential-transfer extension and Pausable, which the original decision rejected. Owner's answers: permanent delegate accepted only if allow-listed; confidential transfer accepted only with auto-approve off and an allow-listed authority; Pausable accepted only if its authority is allow-listed, and a paused mint fails closed at execution. Transfer hooks: allowed program only (the xStocks hook program is empty today, but its authority can set one, so the policy re-runs at every execution). Full table: aroma-guard-v1.md.
3. **ScaledUiAmount.** All xStocks have it; 29 of 40 multipliers ≠ 1, exactly 1 for non-dividend stocks. One token = `multiplier` shares, so the oracle math divides by the multiplier in effect now. It is converted from the `f64` bit pattern to 12-decimal fixed point with integer operations and rounded up (output never above oracle value). No xStock uses interest-bearing; that extension is rejected.
4. **Catch-up and the Subscriptions cap.** Upstream allows `amount_per_period` per time period with no carry-over, so a late installment uses the next period's allowance. The plan requires delegation terms of `(1 + window) × amount` per period and an expiry of `window` periods after the schedule; the plan snapshots the window. Executions take the **oldest runnable period**, so an executor cannot skip an in-window period; the program's accounting still pulls one installment per plan period (proptest).
5. **Config additions** (before `reserved`, layout fixed from the first deploy): `max_confidence_bps`, `treasury`, three Token-2022 allow-lists. `Asset` gains `version`, `extensions`, `scaled_ui_amount`, `mock_mint_bump`, `registered_at`. `Plan` gains `funding_token_program`, `catch_up_window_periods`, `in_progress_period`, `staging_start_balance`, all before `outputs` so every fixed field keeps a fixed offset.
6. **One accounts struct for both builds**, so one IDL and one client; the build script fails if the IDLs differ. The mainnet handler is a single `err!`.
7. **Codama:** `@codama/renderers-js` **2.4.0** with `kitImportStrategy: rootOnly`. No release targets kit 7: 2.4.0 emits code for kit `^6.10`, 2.5.0 and later for `^8.3`. Verified, not assumed: the 2.4.0 output typechecks under the strict config against kit 7.1.1 and runs in LiteSVM, the client tests and the local validator. Imports go through `@solana/kit` and its `program-client-core` subpath, so the web app gained no dependency.
8. **SBPF v0.** anchor-cli 1.2.1 builds SBPF v3 by default; SBPFv3 deployment is inactive on devnet and mainnet, so the build passes `--arch v0` and `check-build.mjs` rejects anything else (found when the local `solana program deploy` refused the v3 binary).
9. **Subscriptions binary pin.** The earlier pin (devnet, slot 480,013,438) no longer matches: devnet was redeployed at slot 506,642,674 after the `program-v0.5.0` release (mainnet: slot 438,440,823, ≈ v0.4.0). M6 pins the current devnet binary and records mainnet's hash; the account layouts are identical in both (asserted in the typed parser).
10. **Oracle:** the program accepts any receiver-owned, fully verified `PriceUpdateV2`. The sponsored equity push accounts exist on devnet but are months stale, so M7's keeper must post updates (Hermes, API key: owner).

**Deviations**
1. The devnet **test USD is created by `init-devnet`** (the config must allow-list it at initialization), not by `register-devnet-assets`.
2. **LiteSVM writes `PriceUpdateV2` accounts** owned by the receiver (and loads one real devnet account) instead of posting through the receiver: a real post needs a Wormhole-signed update from Hermes, which needs an API key. Same in `e2e:local`, which loads them at genesis and therefore uses a 1-hour staleness bound in its local config (the 60 s bound is tested in LiteSVM).
3. **Validator clock:** `e2e:local` uses 15-second periods (the devnet build allows ≥ 10 s; mainnet ≥ 1 hour), because `solana-test-validator` cannot warp its clock.
4. **"Slippage failure on a later leg"** (spec §8) cannot happen in the devnet build, which mints exactly the oracle amount; that case is M8 (Jupiter). Rollback of a whole transaction on any failed leg is covered by the oracle-refusal cases (nothing moves).
5. **Rust coverage** is not measured: `cargo-llvm-cov` is not installed and installing it was out of bounds.
6. **Toolchain download:** the first `anchor build` made `cargo-build-sbf` (Agave 3.1.10) download platform-tools v1.57 into `~/.cache/solana` (the install's symlink already pointed there but the folder was missing), and Criterion, and re-register its rustup link. No installed version changed.

**Findings during the devnet deploy (2026-11-14)**
- A new worktree had a stray program keypair (`9Z5d…`, generated by `anchor build` there); it was renamed to `aroma_guard-keypair.STRAY-9Z5do.json` and the real `FYrr…` key restored. Fixed for good: `check-program-id.mjs` runs in `build.sh` (before `anchor build`, so a missing keypair fails instead of being regenerated, and after) and in `deploy-devnet.sh` (before and after the build), and refuses unless the keypair, `declare_id!`, every `Anchor.toml` entry and the built IDLs agree (`scripts/program-id.test.ts`, 12 cases running the real scripts with stubbed `anchor`/`solana`).
- A private key string was pasted into the agent session before any deployer existed. The agent did not use it; the owner created a fresh deployer in their own terminal, which is the one deployed with. The runbook now says to create keys outside the agent session and never paste one.
- Devnet airdrops were rate-limited; funding went to the keeper in one transfer and was split by keeper-signed transfers ([faucet 1 SOL](https://explorer.solana.com/tx/62EJGEDwN1keEy4EsyJQwpirU5EqTLTtSvwQG74RiZrRXwTpSPiWqQ8yXLRYRk8KhutESNKHEibRvJPcPY2ZXFJh?cluster=devnet), [deployer 6 SOL](https://explorer.solana.com/tx/5wBrVwUvSLmyF48EqfWznwqsyEfNSzst2kQDv7hj8r8bACsL4mjnXJv7na9DcwH3ZAn9GNy6pd86LRUkzoEtYwFX?cluster=devnet)). The deploy used 2.44 SOL net.

**Findings fixed during M6**
- The SBPF v3 default (decision 8); a Prettier run from `apps/web` reformatted the committed IDL (the IDL check now compares parsed JSON); a `tsc` run before the package config resolved emitted 54 `.js` files next to the sources (all removed; none committed); a LiteSVM case that only asserted a constant (removed).

**Evidence (all local; CI not verified, files only; nothing deployed)**
- `pnpm typecheck` ✓; `pnpm lint` **0 errors** (140 warnings, prototype code); `pnpm format:check` ✓.
- `pnpm test`: web Vitest **995 passed, 1 skipped** (baseline 959 / 1); legacy node:test 276 (275 pass, 1 skip; 13 retired, A2); `@aroma/ui` 210; `@aroma/contracts` 16; config 2; keeper 1. Coverage gates hold (overall lines 95.7%; v1 client 100% lines, 97.4% branches).
- `pnpm build:web` passes with the flag off and with `.env.example` and the flag on; `check-client-secrets: OK` both times.
- `cargo test` 25/25 with each feature set; `cargo clippy --all-targets -D warnings` clean with each; `anchor build` (SBPF v0) both variants; `check-build.mjs`: minting marker and `mock_mint` seed absent from the default binary, present in the devnet one; identical IDLs.
- LiteSVM 56/56; `e2e:local` PASS (period 0 on time, 1 caught up, 2 refused with `UnexpectedPeriod` and skipped, 3; close + revoke in one transaction; every leg = oracle floor; treasury +90 tUSD; delegation, authority and token approval gone; rent to the owner).
- Codama drift: passes; fails when the IDL changes (demonstrated with `leg_mask → legs`, then reverted).
- `audit-devnet` against real devnet (read-only): genesis accepted, reports "program is missing" (not deployed yet); against mainnet: refused at the genesis check.
- Secrets: no keypair JSON, private key, `secretKey` or 64-byte array in the tree or in `git log -p m5-creators..HEAD`; the only tracked `.env*` is `.env.example`.

**Shared files edited:** `AGENTS.md`, `.prettierignore`, `.github/workflows/contracts.yml`, `.github/CODEOWNERS`, root `package.json`, `pnpm-lock.yaml` (contracts dev dependencies only), `apps/web/{eslint.config.mjs,tsconfig.strict.json,vitest.config.ts}`, `apps/web/lib/sdk/sdk-rules.test.ts`, `apps/web/tests/sdk/devnet-xstocks.test.ts` (A2), docs. The earlier guard client, `packages/anchor` and the prototype UI are untouched.

**Open items**
- ~~Owner: devnet deploy, init, register, audit~~ done 2026-11-14. Owner: back up the program keypair, the devnet deployer, keeper and faucet keys (paths in M6-DEVNET-DEPLOY.md).
- Owner (M7 B10): a Hermes API key so the keeper can post fully verified prices.
- M7: keeper (post prices, execute oldest-first in leg batches of ≤ 3, alerts), UI (skipped periods; the delegation approval shows `(1 + window) ×` the installment per period, which needs plain wording).
- M8: Jupiter path, verifiable build hash, Rust coverage.
- CI not verified, files only.

### M7 status: implemented on branch `m7-recurring-devnet`, cut from `m6-contract-core` (not pushed, not merged; real devnet run pending: owner)

Exit criteria (§7): create → 3 installments → close + revoke **on a local validator ✓** (on devnet: pending the owner's deploy and accounts, B10); skipped periods shown ✓; keeper alerting tested ✓.

**Part A**
- [x] A1: AUDIT §1 is only the historical record of the prototype contract (no pointer to v1, no milestone tags). ROADMAP, the spec and §7 onward no longer relate v1 to the earlier program (grep in the M7 summary).
- [x] A2: three M8 plan notes under the §7 table (executor choice of price update when `keeper_authority` is `None`; the older mainnet Subscriptions build; `cargo-llvm-cov`).

**Part B**
- [x] B0: **done 2026-11-14.** The owner deployed, initialized and registered on devnet; the agent verified each step from chain and `devnet:audit` passed (M6 status). `V1_DEPLOYMENTS.devnet` holds the program, config, treasury, keeper, test USD, faucet authority and the three assets, with their signatures. Drift, typecheck, tests and both web builds re-run (evidence below). With `V1_DEPLOYMENTS.devnet` null the routes still answer `INVEST_UNAVAILABLE` (`cluster.test.ts`).
- [x] B1: `packages/guard` (`@aroma/guard`): the Codama client, hand-written builders, decoders, schedule, PDAs, deployments, the Pyth feed registry; re-exported by the web app at `@/lib/sdk/guard/v1` and `@/lib/sdk/pyth/feeds`. One `@solana/kit` (7.1.1). The Codama renderer and the drift test moved with it (contracts' `sync-idl` renders into the package). Its own rules test (no `any`, 400 lines, no `apps/*`, server-only or app aliases) and an 85% gate (99.7% lines, 97.6% branches).
- [x] B2: cluster-scoped wallet boundary (`features/wallet/cluster.ts`): mainnet by default (unchanged), devnet for `/v1/invest` only (browser RPC must report devnet's genesis, accounts declaring only other chains refused, own storage key, Privy off), and a `localnet` cluster compiled in only by `NEXT_PUBLIC_AROMA_LOCALNET=true` (env schema and secret scan refuse it in production). Every Signer carries its cluster; `ClusterLabel` shows "Devnet: test tokens, no real value".
- [x] B3: `features/invest/server`: prepare-create (one simulated transaction: Subscriptions authority when missing, the recurring delegation, `create_plan`; a plain-words summary of the `(1 + window) ×` approval and of "at most one installment per period"), prepare-close (close + revoke, and the authority for the last plan of a mint), submit (pa1 authorization + signed bytes, send, confirm, v1 event check, receipts and index; idempotent), `GET /plans?owner=`. Validation mirrors `create_plan`.
- [x] B4: `plans_index` from chain (`getProgramAccounts` with memcmp on the discriminator and owner), from submit and from the keeper; reconciled on read and by the keeper's reconcile step every run (drift logged and repaired); missing installment receipts backfilled from chain history; settled periods without records are shown as "being indexed", never guessed. Migration `0003_plan_receipts`.
- [x] B5: `apps/keeper` (closes AUDIT C-4 for devnet in code): QStash-verified `POST /run`, leases, oldest runnable period, leg batches ≤ 3, fully verified Pyth posts (Wormhole VAA verification + receiver `post_update`), simulate/send/confirm, receipts and index, exponential backoff, dead-letter list with a CLI, de-duplicated and rate-limited Slack/Discord alerts, redacted JSON logs, genesis checks at boot and per client. [keeper-operations.md](./keeper-operations.md).
- [x] B6: `POST /api/v1/faucet` (closes AUDIT H-5 for v1): wallet-signed claim, Turnstile server-side, Redis limits per wallet and per IP, daily budget, 100 test USD + 0.05 SOL for a low wallet, every error logged and surfaced. Owner decision: the test USD mint authority is a dedicated devnet-only faucet key created by `init-devnet` (never the deployer); the audit checks it.
- [x] B7: `/v1/invest`: `PlanWizard`, `PlanCard`, `PlanTimeline` (executed with signature, oracle price and amounts; skipped visible, recorded on chain or not yet; pending, due, in progress, being indexed), `ClosePlanDialog`, faucet panel with Turnstile; unavailable state while the devnet record is null; nav link.
- [x] B8: Vitest for every server, route and keeper module, property tests (timeline vs. a model of the program's bookkeeping, 500 runs; authorization and QStash tampering), LiteSVM for verified posting through the real Wormhole, receiver and v1 binaries (6 cases), coverage gates.
- [x] B9: `pnpm --filter @aroma/web e2e:invest`, 12/12 (below).
- [ ] B10: **pending owner.** The program is on devnet (B0) and a devnet test build now offers a 15-minute period (found while preparing B10: devnet accepted only the presets, so the run would have taken a week of trading days; fixed in `features/invest`, test builds only, with tests). Still needed, exactly:
  1. Env values, set by the owner (names: `apps/web/server/env.schema.ts`, `apps/keeper/src/env.ts`): `PYTH_API_KEY` (keeper; Hermes returns 401 without it); `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` and `DATABASE_URL` (web and keeper, the same devnet Redis and Neon database, then `pnpm db:migrate`); `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` (keeper), plus `QSTASH_TOKEN` and a schedule only when the keeper is hosted; `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (web); `KEEPER_ALERT_WEBHOOK_URL` and `KEEPER_ALERT_FORMAT` (keeper); web `AROMA_V1_ENABLED=true`, `SOLANA_RPC_URL`, `AROMA_TRADE_SECRET`, `AROMA_V1_ALLOW_TEST_SWITCHES=true` (test build only); `KEEPER_KEYPAIR` and `AROMA_V1_FAUCET_KEYPAIR` from the devnet key files (never printed).
  2. A hosted keeper URL (`KEEPER_PUBLIC_URL`) is optional: without one the keeper runs locally against devnet and is triggered by signed direct calls (`pnpm cli run`), [keeper-operations.md](./keeper-operations.md#local-run-against-devnet).
  3. The run itself must happen in **US market hours** (equity feeds publish only then; Hermes updates older than 50 s are refused and the installment deferred). Plan: 4 periods of 15 minutes; periods 0 and 1 executed, keeper paused past period 2's window (≈ 30 min) so it is skipped and shown as skipped, period 3 executed; close + revoke; a forced failure into the dead-letter list; the skip and failure alerts.
  Evidence to collect then: signatures and devnet explorer links, redacted keeper logs, timeline screenshots.
- [x] B11: `ci.yml` coverage gates for `@aroma/guard` and `@aroma/keeper`; `e2e.yml` job `e2e-invest`. Files only.

**Decisions**
1. **Price posts are separate transactions, not in the execute transaction.** Measured: one `post_update` is ~580 bytes and a 1-leg `execute_installment` 800 bytes (1,377 together, limit 1,232), so a 3-leg period is 7 transactions (2 VAA, 3 posts, execute, cleanup). The keeper alone writes those accounts and the program re-checks verification level, feed, staleness and confidence, so this costs fees, not safety.
2. **Faucet mint authority** (owner decision): a devnet-only faucet key (`.keys/devnet-faucet.json`); `init-devnet` refuses the deployer and stops with the `spl-token authorize` command for a test USD created earlier.
3. **The faucet also needs a wallet signature** (AGENTS.md rule 2; Turnstile alone is not a signature, HMAC or bearer secret). The wallet signs a short claim message naming the cluster.
4. **Plan authorizations (`pa1`)** reuse M4's keyring with a key derived for this purpose and a different prefix, so trade and plan tokens never cross; no new secret.
5. **Plans are offered from the on-chain asset registry**; a symbol comes from the asset's registered Pyth feed id. A basket is offered only when every constituent is registered, at its own weights.
6. **Local infra:** M5's Docker Postgres + Neon proxy, and a Docker Redis behind an Upstash-compatible REST proxy, so web and keeper use the production clients locally. A loopback Redis URL is accepted only with test switches, never in production.
7. **The local E2E loads Aroma Guard at its program ID with `--upgradeable-program`** and a runtime upgrade authority; no program keypair is read. Every key (deployer, keeper, faucet, wallets, test guardian) is generated at runtime into git-ignored `.e2e-invest/`.
8. **Hermes stand-in** serves the recorded real devnet AAPL and TSLA prices, freshly timestamped and signed by the test guardian, so the E2E plan is xAAPL 60% / xTSLA 40% (MSFT and NVDA have no recorded price).

**Deviations and findings**
1. Found and fixed by the new checks: `JSON.stringify` on RPC errors (kit returns bigint) threw in submit; the localnet marker reached a production build through `storageKey()`; the key-material scan flagged a BLAKE2b zero buffer (now 16+ distinct values required); the connected `ConnectButton`'s accessible name did not contain its visible text (axe, an M4 component); `prepare-create` loaded the mainnet market catalog for single-asset plans (30 s cold), which let a period pass before signing; the runner read a stale state file; the UI fork found `parseDecimalToRaw` refused values above 15 digits.
2. This worktree's first `anchor build` generated a program keypair (`9Z5d…`) because the owner's `FYrr…` keypair lived only in the M6 checkout. Source, `declare_id!` and the IDL were unchanged. Resolved before the devnet deploy: the stray file is kept as `target/deploy/aroma_guard-keypair.STRAY-9Z5do.json`, the real keypair is in place, and `build.sh`/`deploy-devnet.sh` now refuse a missing or mismatched program keypair (M6 findings).
3. One `pnpm test` run failed one web test while the cargo build ran alongside; it was not identified and did not recur in two reruns.
4. Hermes requires an API key (401 without one), so real guardian-signed updates were not exercised; LiteSVM and the E2E use a runtime test guardian with the real Pythnet data source.

**Evidence (all local; CI not verified, files only; nothing deployed; no devnet or mainnet transaction)**
- `pnpm typecheck` ✓ (6 packages); `pnpm lint` 0 errors (140 warnings, prototype); `pnpm format:check` ✓.
- `pnpm test`: web Vitest 1,060 passed / 1 skipped (baseline 995 / 1; 24 v1-client tests moved to `@aroma/guard`), legacy 275 pass / 1 skip, `@aroma/ui` 210, `@aroma/guard` 81, `@aroma/contracts` 18, `@aroma/keeper` 29, config 2.
- Coverage: web 95.65% lines / 88.9% branches, all gates hold (invest server 96% / 81%); `@aroma/guard` 99.7% / 97.6% (gate 85); `@aroma/keeper` 95.5% / 82.5% (gate 80).
- `pnpm test:contracts` ✓: `cargo test` 25/25 both builds, clippy, both SBPF v0 builds, IDL and Codama drift from `packages/guard`, unit 18, pinned binaries (Subscriptions, receiver, Wormhole), LiteSVM 62/62.
- `pnpm build:web` flag off ✓ (every new page and route 404; `/`, `/markets`, `/sip` 200) and flag on with `.env.example` ✓; secret scan OK both. On the localnet E2E build without the allow flags the scan fails on the E2E and localnet markers.
- Local E2E 12/12 and the keeper log (lease, execute, receipt, skip alert, a dead-lettered forced failure with its alerts).

**Shared and prototype files edited:** `AGENTS.md`, `.gitignore`, `.prettierignore`, `.github/{CODEOWNERS,workflows/*}`, `scripts/check-client-secrets.mjs`, `packages/config/eslint/index.js`, `packages/contracts/{package.json,scripts/*,tests/*,programs/…/close_plan.rs (comment)}`, `apps/web/{package.json,next.config.mjs,middleware.ts,eslint.config.mjs,tsconfig.strict.json,vitest.config.ts,.env.example}`, `apps/web/server/{env.schema,errors,request-guard,csp,db/schema}.ts`, `apps/web/features/wallet/*`, `apps/web/features/shared/{routes.ts,components/NavLinks.tsx}`, `apps/web/lib/sdk/{sdk-rules.test.ts,guard/v1/index.ts,pyth/feeds.ts}` (re-exports), docs. No prototype page, the earlier guard client, `packages/anchor` or `/sip` code was changed.

**Open items**
- Owner (B0): devnet deploy, init (now with the faucet key), register, audit; paste the output; then `V1_DEPLOYMENTS.devnet`, drift and build checks, M6 done.
- Owner (B10): a Hermes API key, a QStash schedule and signing keys, Turnstile keys, an alert webhook, Upstash and Neon for devnet, and a hosted keeper URL; then the real devnet run (create → 3 installments → close + revoke, keeper included).
- CI not verified, files only.
- 2026-11-14 (devnet deploy session): `pnpm typecheck` ✓; `pnpm lint` 0 errors; `pnpm format:check` ✓; `pnpm test` ✓ (web 1,060 + 1 skipped before the test-period fix, then the invest suite 54/54 with 3 new tests; `@aroma/guard` 85; `@aroma/contracts` 30, including the 12-case program ID guard; keeper 29; ui 210; config 2); `idl:check` ✓; Codama drift ✓; `pnpm build:web` flag off ✓ and flag on with `.env.example` ✓, `check-client-secrets: OK` both. Key-material scan: no 64-number array in the tree, the working diff or `git log -p --all`; the only tracked `.env*` is `.env.example`.

### M8 status: implemented on branch `m8-mainnet-path`, cut from `m7-recurring-devnet` (not pushed, not merged, nothing deployed; no mainnet transaction)

Exit criteria (§7): full suite on a mainnet fork ✓ (`e2e:fork`, below); fuzz (proptest) clean ✓; verifiable build hash recorded ✓ (local; the Docker hash is an owner step). The mainnet path is documented in [aroma-guard-v1.md](./aroma-guard-v1.md#mainnet-execution-default-build), the keeper side in [keeper-mainnet.md](./keeper-mainnet.md), the audit package in [audit/](./audit/README.md).

**Checklist**
- [x] B1: `execute_installment_routed(period, leg_mask, routes)` in the default build (`execute/{mainnet,route,common}.rs`, `integrations/jupiter.rs`, `swap_math.rs`):
  - the first leg pulls the installment through Subscriptions (exact debit and credit);
  - per leg: Pyth checks; the oracle floor on the full leg funding; a Jupiter `route_v2` CPI (pinned ID and event authority) with the program-wide swap authority as the only signer;
  - before the CPI: the destination at route index 7 must be the owner's ATA; the prefix and the forbidden accounts are checked; `in_amount` must equal `amount_in`, with no Jupiter fees;
  - after the CPI: staging dropped by exactly the leg's funding, the swap accounts are back at their start, and the owner received at least `min_out`;
  - the Token-2022 policy is re-run (paused mint refused); multi-leg works across transactions with `leg_bitmap`; `InstallmentExecuted` is emitted.

  `execute_installment` stays closed in the default build; the devnet build refuses the routed instruction.
- [x] B2: protocol fee from the leg's funding to `fee_recipient`, tested at 0 and 25 bps. The floor is computed on the full funding, so a fee never lowers `min_out` (LiteSVM and a proptest).
- [x] B3: LiteSVM **85/85**:
  - 62 from M6/M7;
  - 6 mainnet happy paths (1 leg; 2 legs in one transaction; N legs across transactions; fee on/off; replay; catch-up and skip);
  - 12 mainnet refusals (slippage failure on a later leg with full rollback; wrong destination owner; a route paying someone else; a route draining staging; the plan's other funds and the owner's funding account; route terms; writable authority and fake program; decision 1 price age; keeper-only; low confidence; paused mint; closed non-routed instruction);
  - 4 Subscriptions semantics on both binaries;
  - 1 devnet routed refusal.

  The mainnet cases run the default build with **mainnet's Jupiter v6, Orca Whirlpool, Token and Token-2022 binaries** and recorded pools and xStocks mints (slot 469,359,673; SHA-256 pins in `tests/fixtures/mainnet-programs.json`). Proptests (2,000 cases each): never more than `periods × amount` pulled; total delivered ≥ Σ `min_out`; staging never below its start; the fee never lowers the floor. Trident not used (owner: proptest only).
- [x] B4: `pnpm --filter @aroma/contracts e2e:fork`. It forks mainnet (Jupiter, Whirlpool, Subscriptions, Pyth receiver, Wormhole, USDC, AAPLx/TSLAx/NVDAx and their pools, `--clone-feature-set`), loads the default build with a local upgrade authority, then runs `initialize_config`, registration, a plan, the **real keeper** (`runOnce`, `mainnet-fork` mode) for 3 one-hour periods, and close + revoke. Run below.
- [x] B5: keeper mainnet mode (`apps/keeper/src/mainnet/**`), behind `KEEPER_CLUSTER=mainnet` (off everywhere):
  - a separate `KEEPER_MAINNET_KEYPAIR` (the devnet key is refused on mainnet and vice versa); mainnet genesis only in mainnet mode;
  - Jupiter v2 build per leg, validated by M4's reviewed validator (moved to `@aroma/guard/jupiter`, the web app re-exports it) and by the program-mirroring checks; direct routes only;
  - verified lookup tables, simulation before send, priority fees, optional Jito;
  - ≤ 2 legs per transaction with a size fallback;
  - the same leases, retries, dead-letter list and alerts.

  Keeper tests 47, coverage 96 % lines.
- [x] B6: `packages/guard/src/v1/mainnet/**` (swap-authority PDAs, route checks, routed builder, setup), **100 % lines and branches**; the package is at 99.3 % / 95.2 %. Codama was regenerated because the IDL changed (decision 5 below), additively.
- [x] B7: `scripts/verify-build.sh` and `packages/contracts/verifiable-build.json`. The default build's executable hash is `58f20550182f0c9002526a05269ae9971222f2b1e91d2032b39c593b529fb1f8` (file SHA-256 `f97f32ca…d914`), byte-identical after a forced recompile. The Docker (`solana-verify build`) hash is open: the image was not pulled (owner decision).
- [x] B8: [docs/audit/](./audit/README.md): scope and commit, build and hash, threat model, invariants, decisions, limitations, test instructions.
- [x] B9: `contracts.yml`:
  - the `v1` job adds the mainnet binary pins and the mainnet-Subscriptions LiteSVM run;
  - a nightly `mainnet-fork` job;
  - a `verifiable-build` job (Docker image, uploads the binary).

  Files only.

**Decisions**
1. **Executor price choice: keeper-only on mainnet, plus a 20-second price-age cap** (`MAINNET_MAX_PRICE_AGE_S`, combined with config by `min`). Both live in the program's mainnet build as constants; there is no config or layout change.
   - Why: with permissionless execution, anyone can pick the highest price in the staleness window (a looser floor) and choose timing and route, extracting value down to the floor.
   - Keeper-only removes third parties. The 20-second cap limits what even a compromised keeper key can choose.
   - Costs: liveness depends on one keeper (catch-up window, alerts, key rotation by the admin), and the keeper must post and execute promptly.
   - Residual: the keeper's own transaction can be sandwiched down to the floor (≤ the output's slippage), mitigated by priority fees and Jito.
   - Full analysis: [audit/decisions.md](./audit/decisions.md).
2. **Subscriptions on mainnet: no mismatch.**
   - Mainnet's binary: SHA-256 `af3cefa5…8d3a`, ProgramData `HaYb5J9…FfMg`, last deployed at slot 438,440,823 (2026-08-10), read at slot 469,358,055. It equals the M6 record and differs from the devnet pin `2675ad1d…fddbf`.
   - Evidence that behaviour matches: the full LiteSVM suite (62 at the time) passes against it, and 4 direct cases pass on **both** binaries with exact upstream codes (per-period cap 400, no carry-over, expiry 128, delegatee only 130, stale `init_id` 136, same-slot sentinel accepted).
   - Upstream `program-v0.4.0…v0.5.0`: only comments changed in `state/` and the helpers, plus the `init_id` sentinel (commit `55a3efd1`, 2026-07-15), which mainnet's later deploy has.
   - M6's "≈ v0.4.0" was a guess from the slot.
3. **Rust coverage** (cargo-llvm-cov, approved): host lines are 42.9 % for the default build and 38.1 % for devnet-mock. `jupiter.rs` 100 %, `swap_math.rs` 100 %, `math.rs` 95 %. The handlers run only in SBF (LiteSVM), which llvm-cov cannot instrument.
4. **A program-wide swap authority `["swap_authority"]` signs the Jupiter CPI, not the plan PDA** (deviation from the brief's wording). The plan PDA signs only the transfers out of staging.
   - The plan PDA is the Subscriptions delegatee, and its signature should not reach AMM code.
   - Jupiter's `route_v2` needs a signer-owned transit account per output mint. Per plan, that rent would be locked forever once the plan closes.
   - Shared ATAs must return to their starting balance each leg.
5. **IDL change (additive): a new instruction instead of changing `execute_installment`.** The route bytes must arrive as an argument, and `execute_installment(period, leg_mask)` is the ABI being deployed to devnet. The change adds one instruction, `RouteLeg`, and seven appended errors; every existing instruction, account, type and code is unchanged; one accounts struct, identical IDLs for both builds. Decision 1 itself needed no IDL change.
6. **Two routed legs per transaction at most** (M6's batches of 3 were for the devnet build). Three Whirlpool legs need 57 unique accounts, and LiteSVM panics on that transaction. The keeper measures and falls back to one leg per transaction; on the fork every leg ran alone.
7. **Direct routes only** (found by the fork run). A Jupiter route through an intermediate mint needs a third swap-authority account, which the program refuses by design. The keeper asks for direct routes and refuses others before signing.

**Deviations and findings**
1. Found by the fork run:
   - stand-in Hermes prices used the wall clock, while the fork's clock is 18 h ahead after `--warp-slot`; they now follow the fork's clock;
   - an intermittent two-step NVDAx route failed in Jupiter (`InvalidTokenAccount`), which led to decision 7.

   Found by tests: the routed builder accepted a leg mask beyond the plan's outputs (fixed); three routed legs exceed one transaction (decision 6).
2. **Prices on the fork** are signed by a runtime test guardian installed as Wormhole's guardian set, at the market price implied by the recorded Jupiter quote plus 0.3 %. Hermes needs the owner's API key. In LiteSVM, `PriceUpdateV2` accounts are written directly, as in M6.
3. **Fork routes are recorded with `dexes=Whirlpool`**, because proprietary AMMs refuse a stale fork. The keeper itself does not restrict DEXes.
4. `execute/common.rs` copies the devnet `collect`, so as not to touch `devnet_mock.rs` while the devnet deploy runs. It becomes one function after the M7 rebase.
5. The default build's `treasury_token` account is required but unused by the routed instruction (one accounts struct). The keeper passes the treasury's ATA.
6. As in M7, the first `anchor build` in this worktree generated a stray program keypair (`FaUT…`) in git-ignored `target/deploy/`. Source and `declare_id!` are unchanged; it is never used.
7. `packages/config/max-lines-allowlist.json` loses the moved IDL's old web path (shrink-only). In `@aroma/guard` the pinned IDL is data, excluded from lint and from the 400-line rule like the generated client.

**Evidence (all local; CI not verified, files only; nothing deployed; no mainnet or devnet transaction)**
- `cargo test`: default build 38/38 (incl. 4 proptests), devnet-mock 25/25. `cargo clippy --all-targets -D warnings` is clean with each feature set. Both builds are SBPF v0. `check-build.mjs`: minting marker and `mock_mint` seed absent from the default binary; the Jupiter CPI marker present only in the default binary; identical IDLs.
- LiteSVM 85/85, and 85/85 again with mainnet's Subscriptions binary (`test:litesvm:subscriptions-mainnet`).
- `pnpm test:contracts` ✓: cargo test, clippy, both builds, `idl:check`, unit 18, the devnet and mainnet pins (8 binaries, SHA-256 checked), both LiteSVM runs.
- `pnpm test` ✓ (6 tasks):
  - web Vitest 1,060 passed / 1 skipped, and legacy node:test 275 pass / 1 skip (both = M7);
  - `@aroma/ui` 210, `@aroma/guard` 95 (M7: 81), `@aroma/keeper` 47 (M7: 29), `@aroma/contracts` 18, config 2.
- Coverage: `@aroma/guard` 99.3 % lines / 95.2 % branches (gate 85; `v1/mainnet` 100 %); `@aroma/keeper` 96.0 % / 84.8 % (gate 80; `mainnet/` 97.2 %).
- `pnpm typecheck` ✓ (6 packages); `pnpm lint` 0 errors (139 warnings, prototype); `pnpm format:check` ✓.
- Key material: no 64-byte array, private key or keypair file in tracked files or in `git log -p b5c14ad..HEAD`; the only tracked `.env*` is `.env.example`; no hand-written file over 400 lines.

**Shared files edited:**
- Program: `lib.rs`, `constants.rs`, `errors.rs` (appended), `execute/mod.rs`, `integrations/mod.rs`, `Cargo.toml` (`sha2` dev-dependency), `Cargo.lock`.
- Contracts tooling: `packages/contracts/{package.json,.gitignore,scripts/build.sh,scripts/check-build.mjs,tests/litesvm/harness.ts}`.
- Generated client and IDL: `packages/guard/src/v1/{idl,generated}` (regenerated), `packages/guard/{package.json,eslint.config.mjs,src/rules.test.ts,src/v1/index.ts}`.
- Web: `apps/web/lib/sdk/jupiter/{instruction.ts,idl/exact-in.ts}` (re-exports; the IDL README moved).
- Keeper: `apps/keeper/src/{env,rpc,run,send,execute,index}.ts`, `apps/keeper/src/test/world.ts`.
- Repo: root `package.json` (`test:contracts`), `pnpm-lock.yaml` (workspace link only), `scripts/check-client-secrets.mjs`, `packages/config/max-lines-allowlist.json`, `.github/workflows/contracts.yml`.
- Docs: `docs/{aroma-guard-v1,CONTRACT-V1-SPEC,REWRITE-PLAN}.md` (§7 M8 row and this section).

Not touched: `apps/web/features/{invest,compliance}/**`, `middleware.ts`, `packages/guard/src/v1/deployments.ts`, the M6 and M7 status sections, `docs/M6-DEVNET-DEPLOY.md`, `docs/keeper-operations.md`.

**Open items**
- Owner: pull the `solana-verify` image, run `verify-build.sh --docker`, and record and publish the Docker hash (B7). Name the audit commit at merge (P6).
- Owner (M12, when funded, §7.2): mainnet deploy and config (keeper-only, USDC, issuer keys), Squads multisig, mainnet keeper key in a secret store, Jupiter and Hermes API keys, xStocks registration, the swap-authority ATAs, and capped real installments (P5).
- Before M12: re-run `test:fixtures:mainnet` and `test:litesvm:subscriptions-mainnet` on the binaries then live. Confirm a direct USDC route exists for each catalog xStock.
- After the M7 rebase: one `collect` (deviation 4).
- CI not verified, files only.

### Phase A status: implemented on branch `phase-a-beta`, cut from `launch-prep` at `42be080` (not pushed, not merged, nothing deployed; no mainnet transaction)

Exit (§7.3, "work before it"): W1–W4 done in code with tests ✓; owner items (P3 minimum accounts, P5 spot tests, P6 push and deploy from the merged tip) are open and listed in [launch/BETA-RUNBOOK.md](./launch/BETA-RUNBOOK.md).

**Checklist**
- [x] Step 0: baseline recorded (matched: lint 0/139; web 1,203 passed / 1 skipped; guard 99; keeper 47; contracts 30; ui 210; config 2; build and secret scan OK).
- [x] W4: Sentry DSN schema (`server/env.sentry.ts`, `env.sentry.test.ts`, `observability/sentry-init.test.ts`); the "known blocker" notes removed (PRODUCTION-ENV, §7.1 P3).
- [x] W1: wallet-only login; Privy out of every v1 path; lint rule with a fixture test; connect screen with install guides and the SOL constant.
- [x] W2: private-beta gate ([launch/BETA-ACCESS.md](./launch/BETA-ACCESS.md)).
- [x] W3: per-trade and per-day caps ([launch/TRADE-CAPS.md](./launch/TRADE-CAPS.md)).
- [x] Risk disclosure on the invest review (`features/invest/components/ReviewPanel.tsx`; COMPLIANCE.md §5).
- [x] Beta deploy readiness, files only: `pnpm check:prod-env --profile beta` (`server/prod-env.beta.ts`), every beta variable in [launch/PRODUCTION-ENV.md §5](./launch/PRODUCTION-ENV.md#5-phase-a-betadomain-private-beta), the owner checklist [launch/BETA-RUNBOOK.md](./launch/BETA-RUNBOOK.md).

**Decisions**
1. **Gate order: location → beta access → terms**, on the server (`features/beta/server/gate.ts`) and in the ticket (`TradeComplianceGate`). Location is a legal block and comes first (a restricted visitor is not even asked to redeem); beta access decides who may use the product at all, so an uninvited wallet is never asked to sign legal terms for something it cannot use; terms stay the last step before the first quote.
2. **The gate defaults to ON in production** (`NODE_ENV` or `VERCEL_ENV` production, including a local `next start`), off in `next dev`; `off` must be set explicitly; an unreadable value is on. The beta profile requires `on` explicitly.
3. **Middleware reads the wallet** from a cloned, capped body (quote `taker`, Action `account`) or from the **HMAC-verified** authorization (submit), and checks Postgres there too; the handler checks again with its own verified identity. A request the edge cannot attribute to a wallet goes on to the handler, which refuses it by schema or MAC with the precise code (the fork E2E caught an earlier version that answered `BETA_ACCESS_REQUIRED` there and hid `AUTHORIZATION_INVALID`). No in-memory fallback: without a database the gate fails closed (503 `BETA_ACCESS_UNAVAILABLE`).
4. **The prototype's trading routes are closed** while the gate is on (they know nothing of beta access); a beta deployment trades only through v1.
5. **Redemption checks the code before the wallet**: a used code is refused even for the wallet that used it; a wallet that already has access does not consume another code (the transaction rolls back).
6. **Caps: Postgres, not Redis `INCRBY`**: durable totals (no eviction or flush resetting a day), no new dependency (the gate already needs Postgres), and one transaction ties the reservation (primary key = the authorization's `request_id`, so a replay counts once) to `UPDATE … used_raw + n <= cap`. `numeric(20,0)` holds the raw amounts so Postgres can add and compare them atomically (still exact integers; read with `BigInt()`).
7. **Notional = the authorized maximum debit** (all basket legs together); USDT and SOL are priced through Jupiter Price V3 in bigint fixed-point, rounded up; no price → refused. A pre-check on the requested amount runs before any route is built.
8. **Release rules**: a failed submit or a trade that provably never left releases; confirmed keeps; anything undecided keeps counting until the chain says otherwise (stale reservations are settled at the wallet's next quote or submit, read-only: past the blockhash's last valid height with no status → released).
9. **Action quotes reserve and keep for the day**: a Blink client sends the transaction itself, so Aroma cannot see a failure to release on (conservative).
10. **Sentry DSN**: exact shape only (32-hex key, Sentry ingest host with an optional region, numeric project); self-hosted Sentry and legacy secret DSNs are refused.
11. **Beta profile refuses unknown browser-visible variables** (any `NEXT_PUBLIC_*` v1 does not read), which keeps the prototype's embedded-wallet login off `beta.<domain>` without naming it in v1 code.

**Deviations and findings**
1. **Found and fixed: a fail-open at the edge.** Middleware tested `pathname.startsWith("/api/")` on the raw path, so a spelling such as `//api/v1/trade/quote` skipped every API guard in middleware (origin, rate limit, geo and, new, beta). Next.js normally redirects repeated slashes and every handler re-checks, but the edge now also matches a normalised path (`features/beta/paths.ts`); pinned by `server/middleware.compliance.test.ts` and a property test in `server/middleware.beta.test.ts`.
2. The fork E2E now needs the local Postgres for the purchase specs (the caps and the beta gate live there); `E2E_CREATOR=0` turns the gate off but trading then fails closed on the caps.
3. `features/invest/server/deps.test.ts` had a 5 s default timeout for a cold dynamic import (~3 s alone) and timed out under the full parallel suite; its timeout is now 30 s.
4. Outside the files this phase may change, `next.config.mjs` (prototype CSP and the Privy env inlining) and `turbo.json` (`PRIVY_APP_SECRET` in the build hash) still name Privy for the prototype; both go with the prototype in M9.
5. **Found, not fixed (outside Phase A): AAPLx's live Jupiter route is refused** as an "unsupported Jupiter swap variant" by the M4 route review (`features/trade/server/route.ts`). The trade server fails closed, so on mainnet today AAPLx cannot be bought through Aroma until the reviewed Jupiter program schema is refreshed; other xStocks (TSLAx, the sol-energy legs) route. Needs a decision and a reviewed schema update before the beta opens.
6. The E2E itself found two Phase A defects, both fixed: the beta banner sat outside every landmark (axe `region`; now an `<aside>`), and the edge answered `BETA_ACCESS_REQUIRED` for a tampered authorization or a malformed body (now the handler answers `AUTHORIZATION_INVALID` or 400, and still checks beta access). It also showed the M7 invest E2E sending no trusted country after M9's gate (the faucet was geo-refused); the harness now sends one, as the trade E2E does.
7. The axe check for the invest review runs in the invest E2E (real browser, light and dark, with contrast); the web unit tests have no declared axe dependency.

**Evidence (local; CI not verified; nothing deployed; no mainnet transaction)**
- `pnpm test`: web **1,363 passed / 3 skipped** (the 3 are local-Postgres tests, skipped without `DATABASE_URL`; all 3 pass against `scripts/local-db.sh`: creators, beta invites, caps), legacy node:test 276 (275 pass, 1 skipped), guard 99, keeper 47, contracts 30, ui 210, config 2.
- Local Postgres (Docker, Neon proxy): 25 parallel beta redemptions on 25 connections → exactly 1 succeeds; 25 parallel $50 reservations against $200 → exactly 4.
- `pnpm lint` 0 errors; `pnpm typecheck`, `pnpm format:check`, `pnpm build:web` (env check and client-secret scan) OK.
- `pnpm --filter @aroma/web e2e:fork` (local mainnet fork; clones and Jupiter routes read-only, every transaction to the local validator): **33 / 33 passed** with `E2E_STOCK=TSLA` (beta gate 5, compliance 8, buys and refusals 9, caps 2, creators 9). With the default `AAPL` target the purchase specs fail before Phase A code is reached: today's live Jupiter route for AAPLx uses a swap variant the trade server's reviewed schema does not know (`ROUTE_UNAVAILABLE`: "Unsupported Jupiter swap variant", fail closed by design); see deviation 5.
- `pnpm --filter @aroma/web e2e:invest` (local validator, keeper, local Postgres and Redis): **14 / 14 passed**, including the review disclosure with axe in light and dark.

**Open items (owner)**
- P3 minimum accounts and env (BETA-RUNBOOK §1), `pnpm db:migrate` on Neon (§2).
- P6: push, CI green on GitHub, merge, and the `beta.<domain>` deploy from the merged tip (§3).
- Counsel's final texts (terms, disclosures, country list, beta and cap wording) — all copy is placeholder.
- P5 real-money spot tests, about 0.007 SOL plus small USDC (§5): owner only, later.
- AAPLx routing (deviation 5): refresh the reviewed Jupiter swap schema, with review, before AAPLx is offered in the beta.

### M9 / Phase B status: implemented on branch `phase-b-cutover`, cut from `phase-a-beta` at `64c3a17` (not pushed, not merged, nothing deployed; no mainnet transaction)

Exit (§7.3 phase B, the code side): the repo is a v1-only app on clean paths, ready for the owner to point the production domain at it ([launch/CUTOVER-RUNBOOK.md](./launch/CUTOVER-RUNBOOK.md)). The owner items (counsel's texts, P3, P4, P5, P6, DNS) are open.

**Checklist**
- [x] Step 0: baseline (matched Phase A), 52-shot visual baseline, [launch/CUTOVER-MAP.md](./launch/CUTOVER-MAP.md) generated by commands (254 prototype files, 21 kept-to-prototype places, 2 legacy suites to port, the URL map, unused dependencies).
- [x] Step 1: no kept file imported prototype code (enforced by a lint rule until the prototype was gone); the client-secret-scan suites ported to Vitest; genesis constants pinned without prototype files. Approved test-only fix for two base64url-padding flakes, and **canonical-only MAC encoding** for `at1`/`pa1` tokens.
- [x] Step 2: server RPC failover exactly per PRODUCTION-ENV §3 (per-endpoint genesis, transport-only failover, quote affinity, same-bytes re-send, polling stop at `lastValidBlockHeight`), health for both endpoints, alerts; reviewed twice (self + independent review, six findings fixed); fork E2E cases.
- [x] Step 3: prototype pages and APIs deleted; removed APIs answer 410 `{ code: "GONE", message }` (Action headers on `/api/actions/*`); middleware's prototype branches gone.
- [x] Step 4: pages at the root (route groups `(shell)`, `(site)`); 308 redirects in one place (`apps/web/redirects.mjs` via `next.config.mjs`); table-driven gate test for every route; actions.json `/basket/*` + `/v1/basket/*`; SEO from one validated site URL.
- [x] Step 5: `AROMA_V1_ENABLED` removed everywhere (boot and build always validate; `AROMA_SKIP_ENV_CHECK` local only); Tailwind v3 removed (v4 only, preflight and layered utilities, no visual change against the baseline); one strict tsconfig with `noUncheckedIndexedAccess`; ESLint 0 problems; empty max-lines allowlist; prototype variables removed and kept forbidden in the secret scan.
- [x] Step 6: the remaining prototype code, `packages/anchor` and 9 unused dependencies deleted (lockfile: 481 packages removed, none added); the exit grep prints nothing; first-load JS on `/markets` **145 kB**.
- [x] Step 7: nonce CSP on every response; HSTS on production only; header test per route type; route-contract test over every `/api/v1` handler; AUDIT.md M9 lines.
- [x] Step 8: `/settings`; `/portfolio#activity`; honest mode labels; PRODUCT.md surfaces; Lighthouse on every public page; `lighthouse.yml`, `e2e.yml` (files only).
- [x] Step 9: `check:prod-env --profile production`; [launch/CUTOVER-RUNBOOK.md](./launch/CUTOVER-RUNBOOK.md).
- [x] Step 10: ARCHITECTURE rewritten; prototype docs removed; this section; final gate below.

**Decisions**
1. **Redirects in `next.config.mjs` (`redirects()` from `redirects.mjs`), not middleware:** static, declarative, evaluated before middleware, and the same table is unit-tested.
2. **Failover details:** every endpoint (the primary included) proves its genesis before serving, cached 60 s per genesis and URL; failover only on transport, timeout, 5xx and 429; only a well-formed JSON-RPC error (numeric `code`) is a refusal; a quote pins one endpoint at its first answer; submit re-sends the identical signed string only after a transport failure, and after an uncertain first send nothing is recorded `failed`; each status poll reads one node; "never landed" is decided only within 150 block heights after the blockhash expired (also applied to the caps outcome).
3. **Emergency stop:** `AROMA_TRADING=off` replaces the old flag-based stop (middleware and each trading route answer 503; reads, receipts and plan closes stay open).
4. **Preflight on**, utilities in their own cascade layer; the screenshot comparison showed no styling change, only live data.
5. **web3.js v1 stays** in the trade server and the wallet bridge (AUDIT M-12: partial by decision); migration is a post-launch item.
6. `/ui-preview` stays for development and is never served on a production deployment; the broken `scripts/verify-pricing-oracles.mjs` and the `lib/sdk` barrel were deleted; the nav wraps on phones (it widened every page by 172 px at 390 px).

**Deviations and findings**
1. **Jupiter routing:** the live TSLAx route went through **BisonFi**, a DEX the reviewed swap schema does not know; the server refuses such routes (fail closed). The fork E2E records routes without it (test harness only). In production, any route through an unknown DEX is refused until the schema is refreshed (widens Phase A's AAPLx finding; runbook step 1).
2. Steps 5 and 6 interleaved: the strictness items (one tsconfig, warnings as errors, empty allowlist) ran after Step 6's deletion, because the warnings and unchecked indexing were in prototype code.
3. A bulk `/v1` path rewrite in Step 4 also hit two non-page strings (the Neon proxy's `/v1` path and a regex in a test) and Prettier, run from `apps/web`, reformatted the Drizzle snapshots; all found by the E2E and gates and restored before commit.
4. Pre-existing issues found and fixed: the smoke suite also collected the invest specs; its stock test predated the compliance gate; `SOLANA_RPC_URL` that is not a URL made the schema throw; two tamper tests flaked on base64url padding bits. Load-sensitive tests given explicit timeouts (two property tests, `AssetPicker`); `features/caps/routes.test.ts`'s parallel test can see a PGlite reservation fail under full-suite load (fail closed, never a cap breach; frozen Phase A code, not changed).
5. Money-path diff vs `phase-a-beta` (rule 7): the failover wiring (`features/trade/server/{rpc,rpc-pool,rpc-health,submit,deps}.ts` + tests), the approved B fix (`server/auth/{trade,plan}.ts`) and A tests, the caps outcome window, the flag removal (`features/{beta,compliance}/server/http.ts`), comments and type-only imports (lint), and the approved `lib/sdk` test and field cleanups. Nothing else.

**Evidence (local; CI not verified; nothing deployed; no mainnet transaction)**
- `pnpm typecheck`, `pnpm lint` (0 problems), `pnpm format:check`, `pnpm build:web` (env check OK, client-secret scan OK) pass.
- `pnpm test`: web **1,618 passed / 3 skipped** (Phase A: 1,363 / 3 plus 276 legacy node:test; the legacy suite is deleted with the prototype it tested: 61 cases in Step 3, the rest in Step 6, 2 ported; 11 Vitest cases of prototype modules deleted in Step 1), guard 99, keeper 47, contracts 30, ui **173** (37 cases of the prototype token-mapping test removed with the stylesheets it read), config 2.
- `e2e:fork` (`E2E_STOCK=TSLA`): **36/36**, including 3 failover cases (wrong-cluster fallback refused; primary stopped between quote and submit; dropped send answer re-sent with the same bytes, one debit). `e2e:invest`: **14/14**. Smoke suite: **40/40** (redirects, 410, `/settings` axe light/dark).
- `next start` header check: every route type (page, API, Action file, 410, 404) carries the nonce CSP, HSTS with preload, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`.
- Lighthouse 12.8.2 (mobile, local `next start`): performance 96–99 on every public page (stock detail **96**, M3: 88), accessibility 100, SEO 91–92 on every indexable page (the `noindex` pages fail `is-crawlable` by design).
- MERGE-PLAN linearity: all twelve links `OK` through `phase-a-beta → phase-b-cutover`, no merge commits, one identity. Key-material scan over `git log -p phase-a-beta..HEAD`: 6,000 added lines, 0 hits.

**Open items (owner):** counsel's final texts (hard gate); P3 incl. the second RPC provider; P4 rotation drill; P6 push, CI green, `main` protected; the archive URL and DNS; `AROMA_BETA_GATE=off`; P5 spot tests; the Jupiter schema refresh (finding 1); `LICENSE`. **Post-launch:** the web3.js → kit migration (AUDIT M-12); sub-national geo-blocking if counsel asks for it.

**Critical path:** M0 → M2 → M4 (spot trading, shipped) → M6 (contract core and its devnet deploy, done 2026-11-14) → M7 (recurring on devnet) → M8 (mainnet contract path, audit-ready, not deployed) → M9 (cutover, spot live) → M10 (recurring via Jupiter DCA, or the devnet beta) → M11 (launch, within the $5 SOL budget, §7.2) → M12 when funded (audit, multisig, Aroma Guard on mainnet). M7 develops against a local LiteSVM build and the generated client until the owner's devnet deploy lands.

---

## 8. Testing strategy

| Layer | Tool | What |
|---|---|---|
| `lib/sdk` + server units | Vitest + MSW | every port brings its prototype tests; convert `node:test` → Vitest |
| Authorization & money paths | Vitest + property tests (`fast-check`) | HMAC tampering, expiry, signer mismatch, bigint rounding, basket weight sums |
| Contract | LiteSVM (in `packages/contracts`) | see CONTRACT-V1-SPEC §8 |
| API contract | Vitest against route handlers | zod schemas double as fixtures |
| E2E | Playwright with a mocked wallet (deterministic keypair signer) | browse → trade (simulated) → plan create/close on devnet (nightly) |
| Visual & accessibility | Playwright screenshots + axe | light/dark, mobile/desktop |
| Performance | Lighthouse CI, `@next/bundle-analyzer` budgets | first-load JS ≤ 180 kB on `/markets` |

Coverage gates: 85% for `lib/sdk`, 80% for `apps/web/server` and `features/*/server.ts`, and no gate for UI components (covered by E2E).

**Prototype tests worth porting first:** `order-precision`, `trading`, `bundle-authorization`, `composed-transactions`, `jupiter-intermediate-accounts`, `jupiter-lookup-tables`, `jito-bundles`, `creator-auth`, `request-policy`, `market-cache`, `basket-*`, `single-execution-recovery`.

---

## 9. Cutover and retirement

1. While v1 is being built, the prototype runs on its current domain and v1 runs on `next.<domain>`.
2. At M9, announce the switch date on the site.
3. Switch DNS. Keep the prototype on an archived URL for 30 days. Then delete `apps/web/components/aroma`, `styles/*`, `packages/anchor` and the prototype `lib/sdk` modules that are replaced (they stay at the `prototype-final` tag).
4. The v1 program's upgrade authority moves to a Squads multisig in M12 **(owner)**.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| The rewrite drags on and nothing ships | Critical path M0 → M2 → M4 ships spot trading first; M6 (contract core) and M7 (recurring app) are split so app work starts on LiteSVM before the devnet deploy |
| Behaviour regressions in money paths | port prototype tests before the code; property tests on amounts |
| Contract changes break `lib/sdk` | Codama regenerates the client; CI fails on IDL drift |
| Jupiter or Pyth API changes | adapters isolated in `lib/sdk`, responses zod-validated, contract tests run nightly against live APIs |
| xStocks Token-2022 extension surprises | asset registry checks extensions; E2E against the real mints on mainnet with small amounts |
| One developer owns both contract and app | M7 waits on the owner's M6 devnet deploy; until then build against LiteSVM and the generated client. Aroma Guard on mainnet (M12) waits on the M8 contract path, the external audit and funding (§7.2) |

---

## 11. Definition of done (v1)

- [x] Every route is in `apps/web/app` as an RSC page or a thin client island, and the `AromaApp` switch is gone. _(M9: `components/` and `app/(prototype)` deleted; `server/route-gates.test.ts` lists every route.)_
- [x] No file over 400 lines; no global CSS beyond tokens and resets. _(M9: `max-lines-allowlist.json` is empty and lint passes; `app/aroma-ui.css` is the only entry: Tailwind layers, fonts, tokens, theme.)_
- [x] One `@solana/kit` version; the v1 contract client is Codama-generated. _(`lib/sdk/sdk-rules.test.ts`; kit 5.5.1 and 6.10.0 left the lockfile with Privy and `packages/anchor`; `packages/guard/src/v1/generated`.)_
- [ ] All AUDIT.md Critical and High items closed or proven no longer relevant. _(M9: H-4, H-5, H-6 and C-4 closed with evidence; C-1, C-2, H-1–H-3 concern the deleted prototype program; left: H-7 `main` protection and H-8 CI green, both owner P6.)_
- [ ] CI covers lint, typecheck, unit, contract, E2E and Lighthouse, and runs green.
- [x] Docs updated: ARCHITECTURE, protocol (v1), keeper operations. _(M9: ARCHITECTURE rewritten for the system as built and linking `aroma-guard-v1.md` and `keeper-operations.md`; prototype docs removed.)_
- [ ] Every production readiness item in §7.1 (P1–P6) needed for launch is done; the M12 items (audit, multisig, mainnet deployer and keeper, Aroma Guard recurring tests) follow when funded.
- [ ] Launch needed no more than $5 of SOL in owner wallets (§7.2).
