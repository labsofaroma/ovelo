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
| Wallets | Privy (embedded + external) + `@solana/wallet-adapter` for desktop extensions | same, consolidated in one provider |
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

> **Decision (M0): `packages/anchor` is not renamed to `packages/contracts` yet.** AGENTS.md, the Anchor tooling (`idl:sync` writes into `apps/web/lib/sdk/guard/`), the root `test:anchor` and `build:anchor` scripts, and the new `contracts.yml` path filter all name `packages/anchor`, and M0 must not move contract code. `packages/contracts` is created as a sibling **when the v1 program is scaffolded** (you own that work, Phase 1 of the ROADMAP). The prototype `packages/anchor` stays until M7, then is deleted (§9 step 3). When `packages/contracts` appears, update in one change: AGENTS.md, `contracts.yml` paths, `idl:sync`, `CODEOWNERS` and the root scripts.

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

Each milestone is merged to `main` behind feature flags. The prototype stays deployed until M7.

| # | Milestone | Scope | Exit criteria |
|---|---|---|---|
| **M0** | Foundation (week 1) | tag `prototype-final`; new layout; `packages/config`; ESLint, Prettier, Vitest; CI; `server/env.ts`; Sentry + logger; Neon + Drizzle + first migration; Upstash | empty app deploys to a preview URL; CI green; env validation fails on a missing secret |
| **M1** | Design system (week 1–2, **implemented**, see status below) | `packages/ui`: tokens from `foundation.css` and `DESIGN.md`, Tailwind v4, shadcn primitives, `Brand`/`AssetAvatar`/`Change`, light and dark, reduced motion | Storybook or Ladle page for every primitive; axe has zero violations |
| **M2** | Shared helpers cleanup (weeks 1–3) | in `apps/web/lib/sdk`: `core/`, `pyth/`, `jupiter/`, `markets/`, `research/`, `baskets/`, `paper/` ported with their tests | ≥ 85% coverage; one `@solana/kit` version; no `any` in public types |
| **M3** | Read-only app (weeks 2–4) | marketing pages, markets, stock detail, baskets list and detail, watchlist, all as RSC with ISR | Lighthouse ≥ 90 on performance, SEO and accessibility; meets PRODUCT.md data rules (sources, timestamps, stale states) |
| **M4** | Wallet + spot trading (weeks 3–6) | `features/wallet`, `features/trade` (single stock + basket, Jito bundles), receipts, portfolio | Playwright test buys on a mainnet fork or simulator; ported authorization tests pass; rate limits and CSP nonces live |
| **M5** | Creators (weeks 5–6) | publish flow, invites table, dashboard, Solana Actions | creator E2E; single-use invites enforced |
| **M6** | Recurring on the v1 contract (weeks 5–9, after your devnet deploy) | Codama client, `features/invest`, `apps/keeper` on QStash, `plans_index`, alerts, faucet | create → 3 installments → close + revoke works end-to-end on devnet; keeper alerting tested; skipped periods shown in the UI |
| **M7** | Cutover (week 9–10) | point the production domain at v1, retire the prototype routes and the prototype devnet program | prototype plans closed or owners notified; old repo paths deleted; docs updated |
| **M8** | Launch features | notifications, P&L, compliance gate, onboarding funnel ([ROADMAP.md](./ROADMAP.md) Phase 5) | |

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

**Critical path:** M0 → M2 → M4 (spot trading is the revenue path). M6 depends on your contract being deployed. Develop it against a local LiteSVM build until then.

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
2. At M7, announce on the site that **prototype devnet plans will stop being collected** on a given date, and give a one-click "close + revoke" for each plan.
3. Switch DNS. Keep the prototype on an archived URL for 30 days. Then delete `apps/web/components/aroma`, `styles/*`, `packages/anchor` and the prototype `lib/sdk` modules that are replaced (they stay at the `prototype-final` tag).
4. Retire the prototype program: once its plans are closed, set its upgrade authority to none or close the program account to recover rent. Only the original deployer's key can do this.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| The rewrite drags on and nothing ships | Critical path M0 → M2 → M4 ships spot trading first; M6 runs in parallel with the contract |
| Behaviour regressions in money paths | port prototype tests before the code; property tests on amounts |
| Contract changes break `lib/sdk` | Codama regenerates the client; CI fails on IDL drift |
| Jupiter or Pyth API changes | adapters isolated in `lib/sdk`, responses zod-validated, contract tests run nightly against live APIs |
| xStocks Token-2022 extension surprises | asset registry checks extensions; E2E against the real mints on mainnet with small amounts |
| One developer owns both contract and app | M6 waits on the devnet deploy; until then build against LiteSVM and the generated client |

---

## 11. Definition of done (v1)

- [ ] Every route is in `apps/web/app` as an RSC page or a thin client island, and the `AromaApp` switch is gone.
- [ ] No file over 400 lines; no global CSS beyond tokens and resets.
- [ ] One `@solana/kit` version; the v1 contract client is Codama-generated.
- [ ] All AUDIT.md Critical and High items closed or proven no longer relevant.
- [ ] CI covers lint, typecheck, unit, contract, E2E and Lighthouse, and runs green.
- [ ] Docs updated: ARCHITECTURE, protocol (v1), keeper operations.
