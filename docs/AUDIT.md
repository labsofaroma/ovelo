# Aroma — Codebase Audit

_Audit date: 13 November 2026. Scope: the whole monorepo (`apps/web` including `lib/sdk`, `packages/anchor`, tooling, CI)._

Severity scale: **Critical** (funds, integrity or an outage) · **High** (security or correctness risk in normal use) · **Medium** (reliability, maintainability) · **Low** (hygiene, polish).

> **Status update after M0 (branch `m0-foundation`, unpushed).** Items below carry a **Status** line: **Addressed**, **Partial** or **Pending (milestone)**. Items without one are unchanged. Baseline numbers in §0 are from the audit date; measured at M0: 1 `tsc` error (not 4) and 5 failing test files (not 8). See [REWRITE-PLAN.md §7](./REWRITE-PLAN.md#m0-status-implemented-on-branch-m0-foundation-not-pushed-not-merged-nothing-deployed).
>
> **Milestones were renumbered in M6** (REWRITE-PLAN §7): recurring on v1 is now **M7**, the Jupiter mainnet contract path **M8**, cutover **M9**, audit and mainnet beta **M10**, launch features **M11**. Status lines below use the new numbers.

---

## 0. Snapshot of current state

| Area | State |
|---|---|
| Stack | Next.js 15 App Router + React 18, shared helpers in `apps/web/lib/sdk`, Anchor 1.2 program `aroma_guard` (devnet), Upstash Redis, Privy + wallet-adapter, Jupiter, Pyth, Jito |
| Size | ~74k lines of TS/TSX/CSS/Rust across ~500 files |
| Git | **No commits.** Every file is untracked on `main` |
| Tests | JS: 447 tests, 439 pass, **8 fail** (missing files, see §3). Rust: 7 unit tests pass |
| Typecheck | `apps/web` `tsc --noEmit` reports 4 errors, all in tests that import missing modules |
| CI | One workflow (a cron collector) that **cannot run**: it calls `scripts/bot.ts`, which does not exist |
| Mainnet | Spot buys through Jupiter. Recurring buys (SIP/DCA) are **devnet-only** and mint mock stocks |

---

## 1. Smart contract — `packages/anchor/programs/aroma_guard`

The prototype contract cannot be patched into a mainnet product. It is rebuilt from scratch as Aroma Guard v1; see [CONTRACT-V1-SPEC.md](./CONTRACT-V1-SPEC.md).

> **M6:** the findings below are the historical record of `packages/anchor`, which is unchanged. The contract work for M6 is in `packages/contracts`, documented in [aroma-guard-v1.md](./aroma-guard-v1.md); it is not deployed until the owner deploys it.

### C-1 (Critical): anyone can mint any amount of mock stock
**Milestone: M6.**
`execute_swap` mints `output.minimum_amount_out` of each output mint to the owner. That value is **chosen by the plan creator** in `create_plan` (`instructions/execute_swap.rs`, the `mint_to` loop), and nothing ties it to a price. A user can deposit 1 test KUSD and mint 10¹⁸ xAAPL.
- `funding_mint` is **not pinned to KUSD**. Any mint without a freeze authority is accepted, so a user can create their own worthless mint, fund a plan with it and mint unlimited mock stock.
- The mock mint authority is a **single global PDA** (`[b"mock_mint_authority"]`), so every plan can mint every mock mint.

On devnet this makes portfolios, leaderboards, creator stats and receipts that read these balances meaningless, and it is trivial to abuse.

### C-2 (Critical): there is no real swap path; the program is devnet-mock only
**Milestone: M8** (M6 partial).
- The `devnet_mock` flag is stored in `Plan` but **never read**. `execute_swap` always mints and then **burns** the collected funding.
- No swap CPI exists (Jupiter, Raydium or Meteora). The name `execute_swap` is misleading.
- `minimum_amount_out` is fixed at creation for up to a year. Against real markets it would either fail forever or give no slippage protection. A real version needs per-execution bounds based on an oracle (Pyth is already in the SDK).

### H-1 (High): missed installments are skipped forever
**Milestone: M6** (contract), **M7** (UI).
`due_period` allows only `last_executed_period < index`. If the collector misses period N and runs in period N+1, period N is lost for good. The unit test `schedule_never_replays_or_backfills_and_stops_at_expiry` confirms this is intended, but users are never told, and the UI may show "12 installments" when fewer ran.

### H-2 (High): closing a plan does not revoke the Subscriptions delegation
**Milestone: M6** (client), **M7** (UI).
`close_plan` closes the plan and its staging account, but the owner's token-account delegation to `SubscriptionAuthority` stays in place. Users must revoke it separately, and stale approvals pile up in wallets.

### H-3 (High): the upstream account layout is parsed with hard-coded byte offsets
**Milestone: M6.**
`validate_subscription` reads the Subscriptions accounts by raw offsets (`98..106`, `3..35`, `139..171`, …) **without checking a discriminator**. The PDA and owner checks limit the damage, but an upstream upgrade that changes the layout would silently misparse. (The `/// CHECK` comment claims "discriminator validated"; that is not true.)

### M-1 (Medium): no room for upgrades in the account layout
**Milestone: M6.**
`Plan::MAX_SIZE = 197 + 20*42` has no reserved bytes. Adding any field means a realloc migration for every existing plan.

### M-2 (Medium): no admin or safety controls
**Milestone: M6**, and **M10** for the multisig upgrade authority (owner).
There is no pause switch, no allow-list of funding mints, no protocol config account, no `security.txt` and no documented upgrade-authority policy. The upgrade authority is presumably one hot key in `~/.config/solana/id.json` (`Anchor.toml`).

### M-3 (Medium): an unused risky feature is enabled
**Milestone: M6.**
`anchor-lang` is built with `init-if-needed`, which is never used. It invites reinitialization bugs, so remove it.

### M-4 (Medium): stale ABI in the SDK and tests
**Milestone: M6**, and **M9** (the stale helpers are deleted with `packages/anchor`).
The SDK still ships Raydium CPMM helpers (`DEVNET_RAYDIUM_CPMM_PROGRAM`, `decodeDevnetCpmmPool`, `quoteDevnetCpmmExactIn`) and `*V2` aliases. The anchor README says the CPMM runtime fixtures "target a historical ABI". The LiteSVM tests do not cover the current minting flow end to end.

### L-1 (Low)
**Milestone: M6.**
`close_plan` accepts any `rent_payer`. The owner signs, so this is safe, but the rent should simply go to `owner`. There are no events for funding or output mismatches, and `PlanClosed` does not include `owner`.

---

## 2. Web app and API — `apps/web`

### H-4 (High): rate limiting is per instance and can be used to lock everyone out
`middleware.ts` + `createRequestLimiter` keep buckets in a process-local `Map`.
- On Vercel each instance and region has its own map, so the real limit is roughly `120 × instances`.
- When the map reaches 10,000 keys, **every new IP is rejected** (`return Math.ceil(windowMs/1000)`). An attacker who rotates source IPs fills the map and blocks all new visitors for a minute, repeatedly.
- Fix: Upstash Ratelimit (Redis is already a dependency) or Vercel WAF rules, and evict the oldest key instead of failing closed for everyone.

**Status: Addressed in code (M4); Upstash path not verified against a live Redis.** `middleware.ts` now runs on the Node.js runtime and uses `server/ratelimit.ts` (Upstash sliding window, shared across instances and regions) with separate **read** (120/min), **write** (20/min) and **trade** (10/min) buckets per client IP, for prototype and v1 API routes alike. **M5** adds a **creator** bucket (10/min) for challenge issuance and invite redemption, puts every non-GET `/api/v1/actions/*` in the trade bucket, and removes the creator handlers' own limiters (which shared one `"local"` bucket without a trusted proxy). When Redis is unreachable it degrades to a bounded per-process limiter that evicts the oldest key and never rejects every new identifier (tested: `server/ratelimit.test.ts`, `server/middleware.test.ts`). With v1 on in production, a missing Redis fails closed. The old `createRequestLimiter` remains in `lib/server/request-policy.ts` only for its own legacy test, and is deleted at M9. Not verified: 429s from a real Upstash instance (no credentials in M4; the local fallback produced the 429s in tests and E2E).

### H-5 (High): the devnet faucet can be drained
**Milestone: M7.**
`/api/faucet` has no authentication or CAPTCHA. Its only guard is a **15-second, in-memory, per-wallet cooldown** (`lib/server/faucet.ts`). Generating fresh wallets bypasses it completely, and each claim sends up to 1,000 KUSD + 0.1 SOL. The SOL top-up also swallows every error silently.
- Fix: cooldowns stored in Redis by wallet **and** IP, the Cloudflare Turnstile you already allow in the CSP, a daily budget, and a lower SOL top-up.

### H-6 (High): permissive CSP
`script-src 'self' 'unsafe-inline'` cancels most XSS protection on a page that signs wallet transactions. `connect-src https: wss:` allows exfiltration to any host. `img-src https:` is broad. Move to nonce-based scripts (Next.js middleware nonces) and an explicit list of connect hosts (RPC, Jupiter, Pyth, Privy, Jito, Upstash is server-side only).

**Status: Addressed for v1 (M4); Partial overall.**
- `/v1/*` and `/api/v1/*` get a per-request nonce CSP from middleware (`server/csp.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'` with no `'unsafe-inline'`, an explicit `connect-src` derived from configuration (browser RPC and its websocket, Sentry ingest, Plausible) plus the fixed client endpoints (Jupiter, Hermes, Privy, Jito, WalletConnect, Turnstile), no wildcard schemes, and an `img-src` limited to the issuer logo hosts. All v1 pages trade, and they have their own root layouts, so no prototype script runs there.
- **Still open, M9:** prototype routes keep the old policy. `next.config.mjs` scopes it to non-v1 paths. To tighten them: render the prototype root through a nonce-aware layout (its inline theme script needs the nonce), list the hosts the prototype calls from the browser (its own `/api`, Privy, WalletConnect, Vercel scripts), and drop `'unsafe-inline'`. That is easiest once the prototype pages are deleted at M9.

### M-5 (Medium): internal error messages reach clients
19 API handlers return `error.message` directly (for example `faucet`, `recurring/collect`). RPC errors, keypair-parse failures and Redis errors can leak infrastructure details. Map errors to user-safe codes and log the details on the server.

**Status: Partial (M4 covered the trade and portfolio routes).** Every `/api/v1` handler (`health`, `revalidate`, `trade/quote`, `trade/submit`, `trade/:id`, `portfolio/:wallet`, `prices`) returns only `{ code, message }` through `mapError`. Upstream, RPC and simulation details go to logs, and the user sees fixed, coded messages (`server/errors.ts` gained trade codes; route-contract tests in `features/trade/routes.test.ts` check that an internal error text never reaches the body). The prototype handlers that M4 replaced (`trade/order`, `trade/execute`, `transaction/execute`, `buy-basket`, `bundles/execute`, `bundles/status`, `portfolio`) still serve the prototype until M9 and still return `error.message`. **M5:** the v1 creator routes (`/api/v1/creators/*`) and Actions (`/api/v1/actions/*`) return only `{ code, message }` too, including Action errors (with the Actions headers). The prototype `/api/creators/*` and `/api/actions/*` still return `error.message` until M9; recurring and faucet move in M7.

### M-6 (Medium): a requirement on a missing `Origin` header
`allowedOrigin` accepts requests that have no `Origin`, because native apps omit it. That is fine for unauthenticated reads. Make sure every state-changing route also needs a signature or HMAC token, as trade, creator and collector routes already do. **`/api/faucet` does not.**

**Status: Addressed for `/api/v1` (M4); `/api/faucet` still pending (M7).** Every state-changing `/api/v1` route rejects a foreign `Origin` twice: once in middleware (allowlist) and once in the handler (`assertSameOrigin` in `server/http.ts`). `POST /api/v1/trade/submit` also needs the HMAC trade authorization and a valid wallet signature on every authorized message. `POST /api/v1/trade/quote` changes no state and signs nothing. `POST /api/v1/revalidate` needs its bearer secret. A request with no `Origin` is accepted only because of those credentials. Tested in `features/trade/routes.test.ts` and `server/middleware.test.ts`.

**M5:** the creator routes rely on middleware's allowlist alone (their own `assertSameOrigin` fell back to `request.url`, which `next start` rewrites to localhost, the bug M4 fixed in middleware; deleted). Every creator mutation also needs a single-use challenge signed by the wallet (`server/auth/creator.ts`); the v1 Action's receipt callback needs the HMAC trade authorization and is checked against the transaction read back from mainnet. Action paths are deliberately open to any origin (they only prepare owner-signed transactions), like the prototype's. Tested in `server/middleware.creators.test.ts` and `server/middleware.actions.test.ts`.

### M-7 (Medium): no real health check or observability
`/api/health` returns a hard-coded `ok`. There is no RPC, Redis or Jupiter probe, no structured logging, no Sentry or OpenTelemetry, and no alerting on collector failures.

**Status: Partial.** Added: `GET /api/v1/health` (RPC genesis and slot lag, Redis, Postgres, with timeouts), pino JSON logs with redaction, and Sentry (no-op without a DSN). **M4:** Jupiter Price v3 and Pyth Hermes probes (`server/health-providers.ts`; keyless or rate-limited Jupiter is `degraded`, and a stale Pyth publish time is `degraded`), plus one structured, redacted log line and a Sentry breadcrumb per trade stage (`server/telemetry.ts`; wallets and signatures become fingerprints). Still pending: alerting (keeper alerts at M7) and OpenTelemetry. The old `/api/health` is unchanged.

### M-8 (Medium): very large components
`Details.tsx` (1,362 lines), `Account.tsx` (926), `RecurringInvestingPanel.tsx` (864), `BasketBuilder.tsx` (803), `DevnetPlansList.tsx` (757). There is no data-fetching layer (React Query/SWR), and state lives across `localStorage` in seven components. This makes the UI hard to test and to change.

### M-9 (Medium): state stored on disk on serverless
`disk-cache.ts` writes to `.aroma-cache` or `/tmp`. On Vercel this is per instance and temporary, so cache hit rates are unpredictable. Use Redis or the Next Data Cache for everything.

**Status: Partial (M3).** Every v1 read path (`apps/web/features/*/server.ts`) uses the Next Data Cache (`unstable_cache` with tags `v1:markets` / `v1:research[:mint]`, refreshed by `revalidate` and by `POST /api/v1/revalidate`) and never imports `disk-cache.ts`. An outage is never cached, so the last good snapshot keeps serving with its original timestamp and is labelled stale. The prototype's `lib/server/disk-cache.ts` still serves the prototype routes and is deleted at M9 with them; `server/redis.ts` remains available for M4 caches that need cross-instance locks.

### L-2 (Low)
- HSTS is set twice and has no `includeSubDomains; preload`.
- `lib/metadata.ts` has a TODO for the social preview image (no OG image).
- Mixed code style: some files are Prettier-formatted, some are one-liners (`request-policy.ts`, `trade-authorization.ts`).
- `next lint` is the lint script, but there is no ESLint config or dependency, and `next lint` is deprecated in Next 15.5+.
- `tsconfig.tsbuildinfo` (1 MB) and `.DS_Store` files sit in the tree.
- React 18 with Next 15. Plan the move to React 19.

**Status by item:**
- HSTS set twice, no `includeSubDomains; preload`: **Addressed (M4).** Middleware sends one `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` header on every HTTPS response (prototype and v1), never on loopback HTTP. Preload is a domain-wide commitment: see `docs/M4-DEPLOY.md`.
- No OG image in `lib/metadata.ts`: **Addressed for v1 (M3).** `GET /v1/og.png` is a generated, branded static image (no prices or figures) and every v1 page references it through `features/shared/metadata.ts`, with canonical URLs. The prototype's `lib/metadata.ts` still points at the missing PNG; it is replaced at M9 with the prototype pages.
- Mixed code style: **Partial.** Prettier is configured and enforced for new code only; prototype files keep their style until they are rewritten.
- `next lint` with no ESLint config: **Addressed.** ESLint 9 flat config via `packages/config`, run by `pnpm lint` through Turbo (0 errors; 219 warnings in prototype code).
- `tsconfig.tsbuildinfo` and `.DS_Store` in the tree: **Addressed.** Deleted and ignored (they were never tracked).
- React 18 with Next 15: **Addressed (M4).** React 19.2.9 across `apps/web` and `packages/ui`, with peer ranges checked.

---

## 3. Repository, tooling and CI

### C-3 (Critical): the repository references files that do not exist
| Reference | Where | Missing |
|---|---|---|
| `apps/mobile` | root `package.json` (`dev:mobile`, `typecheck`, `test:upgrade`), `pnpm.overrides` (react-native, metro), `patches/@expo__cli` | whole app |
| `scripts/bot.ts` | `keeper:trigger`, `.github/workflows/*` | yes |
| `scripts/dev-api-tunnel.mjs`, `create-devnet-xstocks.cjs`, `check-client-secrets.mjs`, `audit-devnet-recurring.mjs` | scripts and tests | yes |
| `tests/` (root) | `pnpm test` | yes |
| `docs/actions-and-collector.md`, `docs/aroma-guard-protocol.md`, `PRODUCT.md`, `AGENTS.md` | `.env.example`, anchor README, `.21st/DESIGN.md` | **now created** |

As a result `pnpm typecheck`, `pnpm test`, `pnpm test:upgrade` and the cron workflow all fail.

**Status: Addressed** (the references are gone; the missing scripts are not recreated).
- `apps/mobile` removed from the root scripts, `typecheck`, the `react-native`/`metro` overrides and `.npmrc`; `patches/@expo__cli` deleted.
- `keeper:trigger`, `dev:api-tunnel` and `devnet:create-xstocks` removed (replacements planned: keeper on QStash and devnet provisioning in M6).
- `pnpm typecheck` and `pnpm test` run green. 16 tests are skipped, each marked `TODO(milestone)` ([list](./REWRITE-PLAN.md#m0-status-implemented-on-branch-m0-foundation-not-pushed-not-merged-nothing-deployed)). `check-client-secrets.mjs` and `audit-devnet-recurring.mjs` are still missing; their tests return in M4 and M6.

### C-4 (Critical): the recurring collector does not actually run
**Milestone: M7.**
The GitHub Action runs every 10 minutes, fails at `scripts/bot.ts` and burns Actions minutes. GitHub cron is also best-effort; delays of 10–60 minutes are common. Combined with H-1, users lose installments. Use Vercel Cron or Upstash QStash calling `GET /api/recurring/collect` with the bearer secret, plus alerting.

**Status: Partial.** The broken `recurring-bot.yml` workflow is deleted, so it no longer burns Actions minutes (after the branch is pushed and merged; the scheduled run on GitHub keeps failing until then). **Pending (M7):** the real collector, `apps/keeper` on QStash with alerting. `apps/keeper` is an empty placeholder today, so **nothing collects recurring plans**, as before.

### H-7 (High): no version control history
Nothing is committed. There is no rollback, no review and no blame. Make a first commit now.

**Status: Addressed locally; protection pending.** The repo has history (`e85d128`), the `prototype-final` tag, and the M0 work as small commits on `m0-foundation`. Pending: pushing the tag and branch, and a branch-protection rule on `main` (needs your go-ahead).

### H-8 (High): no CI quality gate
No workflow runs typecheck, tests, `cargo test`, `anchor build`, IDL sync check, lint or `pnpm audit`.

**Status: Partial.** `ci.yml` (install, format, lint, typecheck, tests, build, informational `pnpm audit`) and `contracts.yml` (`cargo test` and an IDL-drift check) are written; both pass their steps locally but **have not run on GitHub** yet. Not in CI: `anchor build`, the LiteSVM runtime tests (they need SBF fixtures), Playwright and Lighthouse (later milestones).

### M-10 (Medium): tests reach into another package's `node_modules`
_Fixed:_ three web tests imported `packages/sdk/node_modules/@solana/kit-v1`. The SDK is now part of the web app and they import `@solana/kit-v1` normally.

### M-11 (Medium): an outside developer's machine path is committed
`.codex/hooks.json` points at `/home/utkarsh/.agents/...`. Remove it or make it opt-in per developer.

**Status: Addressed.** `.codex/` deleted and ignored (it was never tracked).

### M-12 (Medium): two Solana SDK generations side by side
`@solana/web3.js` v1, `@solana/kit` 3.x (web) **and** 7.1.1 (sdk) **and** `kit-v1` aliased to 8.3.0. This bloats the bundle and invites type mismatches. Pick one kit version.

**Status: Partial (one kit addressed in M2; web3.js v1 still in server code).** Checked in M4:
- **One `@solana/kit`:** `apps/web` depends on `@solana/kit` 7.1.1 only, enforced by `lib/sdk/sdk-rules.test.ts`. The lockfile still carries 5.5.1 (transitive, via Privy → `x402` / `@coinbase/cdp-sdk`) and 6.10.0 (dev only, via `litesvm` in `packages/anchor`). Neither is imported by app code. `kit-v1` (8.3.0) is gone.
- **web3.js v1:** in the v1 client bundle it is confined to the wallet bridge (`features/wallet`, M4). It is **not** yet gone elsewhere. Server-side it is still used by `lib/sdk` (`baskets/mainnet.ts`, `baskets/bundle.ts`, `jupiter/simulate.ts`, `jupiter/route-plan.ts`, `core/mint-precision.ts`, `pyth/solana.ts`, `markets/sources/backpack.ts`, plus the prototype-only `guard/*` and `subscriptions/*`) and by `server/rpc.ts` (`Connection`). The prototype uses it in about 40 files. Moving those server modules to kit is open work; the prototype files go at M9.

### L-3 (Low)
- `.gitignore` hides many internal docs (`docs/audits/`, `docs/deployment.md`, `TODO.md`). Fine, but contributors then lack them, so keep public summaries.
- No `LICENSE`, `CODEOWNERS`, PR template, Dependabot/Renovate or `engines` field.

**Status: Partial.** Added: `CODEOWNERS`, PR template, Dependabot config and the `engines` field. `LICENSE` is a **placeholder**; the license is still to be chosen. Hidden internal docs: unchanged.

---

## 4. Product gaps

1. **Recurring investing works only on devnet.** This is the product's main promise and is not shippable yet.
2. **No notifications** (email, push or Telegram) for executed or failed installments.
3. **No portfolio history or P&L for real holdings.** Basket performance exists, but cost basis per wallet does not.
4. **The creator economy is invite-only** with multi-use, never-expiring invite codes and no reward mechanism.

   **Status: Addressed for v1 invites (M5); rewards still open.** v1 invites are rows in Postgres holding only the SHA-256 of the code, **single-use by default** (`--uses` up to 100) and **always expiring** (1–90 days; an invite without an expiry is refused, fail closed). Redemption is one transaction: a conditional `UPDATE … uses < max_uses AND expires_at > now()` plus the `creators` row, and it must be signed by the wallet being registered. Proven by a 25-way parallel redemption on PGlite and, in M5b, on real Postgres through the Neon driver (25 connections, exactly one succeeds: `features/creators/invites.postgres.test.ts`), and by the creator E2E refusing a used invite. Codes come only from the admin CLI (`scripts/create-invite.ts`, printed once). The prototype's `CREATOR_INVITE_CODES` flow still serves the prototype `/creators` page until M9. Still open: any reward mechanism (no product decision yet), and creator usage is now measured from confirmed receipts (`features/creators/stats.ts`), never self-reported.
5. **No compliance layer**: no geo-restriction for tokenized securities (xStocks are not available to US persons), no terms acceptance gate before trading, no clear risk disclosure on each trade.
6. **No onboarding funnel analytics** (consent-gated Plausible exists, with no event plan).
7. **The mobile app is referenced but missing.**

See [ROADMAP.md](./ROADMAP.md) for the v1 rebuild plan.
