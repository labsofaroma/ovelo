# Aroma v1 — Rebuild Plan

_Written 13 November 2026. The current codebase is treated as a **prototype**. Aroma v1 is rebuilt from the ground up: a new repo layout, the Aroma Guard v1 contract deployed from your own account, a new SDK surface and a new web app. Proven pieces of the prototype are carried over deliberately, not inherited by default._

The detailed engineering plan (stack, repo layout, module-by-module mapping, API and data model, milestones) is in [REWRITE-PLAN.md](./REWRITE-PLAN.md).

Why rebuild instead of patching: see [AUDIT.md](./AUDIT.md). The repo references code that isn't there (C-3). The collector never runs (C-4). There is no version history (H-7).

---

## 1. Target structure

```
aroma/
  apps/
    web/                 Next.js (App Router), UI + thin API routes
    keeper/              standalone collector service (QStash/Vercel Cron target)
  packages/
    contracts/           Anchor workspace: aroma_guard v1 (see CONTRACT-V1-SPEC.md)
    config/              shared tsconfig, eslint, prettier
    ui/                  design tokens + shared React primitives
  docs/
  .github/workflows/     ci.yml, contracts.yml, deploy.yml
```
There is no separate SDK package for now. The chain, market and basket helpers stay inside the web app at `apps/web/lib/sdk` (see [REWRITE-PLAN.md](./REWRITE-PLAN.md)); split them into a package only when a second app (keeper, mobile) needs them. Mobile is left out of v1. Ship a PWA first and add `apps/mobile` (Expo) once the web app is stable.

## 2. What to carry over from the prototype

| Prototype module | Decision | Notes |
|---|---|---|
| `lib/server/trade-authorization.ts` | **Keep** | solid HMAC + message hash + signature check |
| `lib/server/request-policy.ts` `readLimitedJson` | **Keep** | streaming body limit is correct |
| `request-policy.ts` rate limiter | **Rewrite** | Upstash Ratelimit (AUDIT H-4) |
| `lib/server/jupiter-*.ts`, `sdk/jupiter*.ts`, `jupiter-idl/` | **Keep, then clean up** | needed by the keeper and the spot buys |
| `sdk/pyth-oracle.ts`, `pyth-streaming.ts` | **Keep** | also used by the contract design |
| `sdk/markets.ts`, `research.ts`, `basket/*` | **Keep, then split** | good logic, large files |
| `lib/server/creator-auth.ts` | **Keep** | add single-use, expiring invites |
| `lib/server/recurring-*.ts`, `sdk/guard/*` | **Drop** | prototype only; removed with the prototype UI (M9) |
| `lib/server/faucet.ts` | **Rewrite** | Turnstile + Redis limits (AUDIT H-5) |
| `lib/server/disk-cache.ts` | **Drop** | Redis or the Next Data Cache only |
| Raydium CPMM helpers, `*V2` aliases | **Drop** | dead code |
| `packages/anchor` | **Drop** | unused code once the prototype UI is removed (M9) |
| `components/aroma/*` | **Rebuild** | split the 800–1,300-line components; keep the visual design (`.21st/DESIGN.md`, `styles/foundation.css`) |
| `apps/web/tests/*` | **Port the relevant ones** | they encode many edge cases; keep the ones that apply to kept modules |
| `.codex/hooks.json`, broken cron workflow, `tsconfig.tsbuildinfo` | **Drop** | |

---

## 3. Phases

**Phases → milestones** ([REWRITE-PLAN.md §7](./REWRITE-PLAN.md#7-build-order-and-exit-criteria)): Phase 0 = M0; Phase 1 (contract) = **M6** (core + devnet deploy), **M8** (Jupiter mainnet path) and **M12** (audit, multisig, mainnet deploy, when funded: REWRITE-PLAN §7.2); Phase 2 = M2 (helpers) and the v1 client in M6; Phase 3 (keeper) = **M7**; Phase 4 (web app) = M1, M3, M4, M5, **M7** (`features/invest`) and **M9** (cutover); Phase 5 (launch features) = **M10** (mainnet recurring through Jupiter DCA, no program deploy) and **M11** (the rest, launch); Phase 6 comes after launch.

### Phase 0: New foundation (week 1)
- [ ] Commit the prototype as-is and tag it `prototype-final`, so nothing is lost.
- [ ] Create the v1 layout (§1) on a fresh branch. Use `packages/config` for shared tsconfig, ESLint 9 and Prettier.
- [ ] Use one Solana SDK generation: `@solana/kit` at a single pinned version, with web3.js v1 only where the wallet adapter forces it.
- [ ] CI (`ci.yml`): install → lint → typecheck → unit tests → build. `contracts.yml`: `cargo test` → `anchor build` → LiteSVM → IDL drift check.
- [ ] Renovate, `LICENSE`, `CODEOWNERS`, a PR template and protected `main`.

### Phase 1: Contract v1 (weeks 1–8, you own this)
Follow [CONTRACT-V1-SPEC.md](./CONTRACT-V1-SPEC.md):
1. Write the contract.
2. Deploy to devnet from **your own wallet** under its own program ID (§10 of the spec).
3. `initialize_config` and register the test assets.
4. Write the full LiteSVM suite.
5. Add the Jupiter CPI path.
6. External audit, then multisig handover, then mainnet beta with caps.

### Phase 2: Shared helpers (weeks 2–5)
_Done in place, with no separate package._
- [ ] Keep the chain, market and basket helpers in `apps/web/lib/sdk` and split the largest files.
- [ ] Add the v1 contract builders and decoders there, generated from the v1 IDL (Codama).
- [ ] Use `bigint` for every amount. Validate every external response with zod.

### Phase 3: Keeper service (weeks 4–6)
- [ ] `apps/keeper`: a stateless handler triggered by QStash or Vercel Cron every 1–5 minutes.
- [ ] Scan `Plan` accounts (`getProgramAccounts` with a memcmp filter, or a Helius webhook index), build Jupiter routes, and submit `execute_installment`.
- [ ] Redis leases per `(plan, period)`, retries with backoff, a dead-letter list.
- [ ] Slack/Discord alerts for failed or skipped installments and a low fee-payer balance.

### Phase 4: Web app v1 (weeks 3–9)
- [ ] Feature folders: `markets/`, `stock/`, `baskets/`, `invest/` (recurring), `portfolio/`, `creators/`, `account/`.
- [ ] TanStack Query for server state, and one persisted store for preferences.
- [ ] zod-validated API routes with stable error codes (no `error.message` sent to clients).
- [ ] Security headers: CSP with nonces, an explicit `connect-src`, HSTS preload. Turnstile on the faucet and creator routes.
- [ ] Sentry, structured logs and a real `/api/health` (RPC lag, Redis, Jupiter, Pyth).
- [ ] Playwright E2E: landing → connect → paper trade → devnet recurring plan → close + revoke.
- [ ] Lighthouse CI budgets. Lazy-load GSAP and wallet adapters.

### Phase 5: Launch features (weeks 8–12)
1. **Mainnet recurring investing**, after the audit: USDC → xStocks basket every week or month.
2. **Notifications**: email (Resend), web push and Telegram for executed, failed and low-balance installments.
3. **Portfolio analytics**: cost basis from on-chain history, P&L per holding and per basket, CSV export.
4. **Compliance**: geo-blocking (xStocks are not offered to US persons and some other jurisdictions), a terms gate before the first trade, a risk disclosure on every trade review.
5. **Onboarding**: for standard Solana wallets (no Privy or email wallets, REWRITE-PLAN §7.3 W1): install or connect a wallet → get a little SOL and USDC (on-ramp links) → first basket in under 2 minutes, with a consent-gated funnel.
6. **Creators**: single-use or expiring invites, profile pages, Blink share buttons, optional fee share from the protocol fee.

### Phase 6: Scale and trust (after launch)
- Public status page, transparent protocol stats, bug bounty (Immunefi).
- Paid RPC (Helius or Triton) with failover.
- Mobile app (Expo). Extract `apps/web/lib/sdk` into a shared package at this point.

---

## 4. Success metrics
| Metric | Target |
|---|---|
| CI green on main | 100% |
| Installments executed within 5 minutes of being due | ≥ 99% |
| Failed installments that trigger an alert | 100% |
| Time to first basket buy (new user) | < 2 min |
| p95 latency of `/api/markets` | < 300 ms |
| Critical or High audit findings open at mainnet launch | 0 |
