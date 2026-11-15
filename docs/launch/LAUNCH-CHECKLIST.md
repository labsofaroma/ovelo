# Launch checklist (M11)

_Written at the M11 tip on branch `m11-launch` (2026-11-15). Not pushed, not merged, nothing deployed, no mainnet transaction sent by any session. "Owner" items need an account, a key, money, a signature or a deploy, so no session can do them. Sources: REWRITE-PLAN §7.1 (P1–P6), §7.2 (SOL budget) and §11 (definition of done); ROADMAP §4 (success metrics)._

## 1. Production readiness (REWRITE-PLAN §7.1)

| # | Item | Status | Evidence | Next step |
|---|---|---|---|---|
| P1 | Legal and compliance advice | ✅ Done (owner) | M9 compliance gate implements counsel's decisions ([COMPLIANCE.md](./COMPLIANCE.md) §1–§5) | Counsel's **final texts** (terms, disclosures, country list) are still a hard gate (CUTOVER-RUNBOOK §2), and the **M11 wording** too (COMPLIANCE §6) |
| P2 | External audit booked for Aroma Guard v1 | ✅ Done (owner) | Booked; runs at M12 on the M8 code | Reschedule to when the deploy is funded |
| P3 | Production accounts and keys | 🟨 Prepared, owner to execute | [PRODUCTION-ENV.md](./PRODUCTION-ENV.md) §1–§6; `pnpm check:prod-env --profile beta|production` (M11: channels, worker secret, analytics domain, fees) | Create the accounts (BETA-RUNBOOK §1), including the M11 channels: a Telegram bot, VAPID keys and the QStash schedule. No email provider |
| P4 | Key custody | 🟨 Prepared, owner to execute | [KEY-CUSTODY.md](./KEY-CUSTODY.md); rotation drill test; `pnpm check:custody` | Trade-secret rotation drill on production (CUTOVER-RUNBOOK §5). M11 secrets: `AROMA_NOTIFY_WORKER_SECRET`, `TELEGRAM_*` and `VAPID_PRIVATE_KEY` go into Vercel only. Deployer, multisig and mainnet keeper: M12 |
| P5 | Small real-money mainnet tests | ⬜ Owner | Fork E2E 43/43 (notifications, P&L and onboarding included); nothing on mainnet | One stock and one three-stock basket on `beta.<domain>` (BETA-RUNBOOK §6, about 0.007 SOL); then on production (CUTOVER-RUNBOOK §8). Aroma Guard recurring: M12 |
| P6 | Merge, CI, `main` protection | 🟨 Prepared, owner to execute; **CI not verified** | [MERGE-PLAN.md](./MERGE-PLAN.md); the linearity check through `m10-recurring → m11-launch` (REWRITE-PLAN, M11 status) | Push in order, CI green, protect `main`, deploy from `main` |

## 2. Definition of done (REWRITE-PLAN §11)

| Item | Status | Evidence |
|---|---|---|
| Every route in `apps/web/app` as an RSC page or a thin island | ✅ | `server/route-gates.test.ts` lists every page and API route, the M11 ones included |
| No file over 400 lines; no global CSS beyond tokens and resets | ✅ | `pnpm lint` (max-lines, 0 warnings); M11 adds no CSS file and no inline hex colour |
| One `@solana/kit` version; Codama client | ✅ | `lib/sdk/sdk-rules.test.ts` |
| All AUDIT Critical and High items closed or not relevant | 🟨 Owner | Open: H-7 and H-8, both P6. M11 added none (AUDIT §5) |
| CI covers lint, typecheck, unit, contract, E2E, Lighthouse and runs green | 🟨 Owner | Workflows are written; **CI not verified** (never run on GitHub) |
| Docs updated | ✅ | ARCHITECTURE (M11 sections), PRODUCT, COMPLIANCE §6, AUDIT §5, BETA-RUNBOOK, CUTOVER-RUNBOOK §12, PRODUCTION-ENV §6, ROADMAP §4 |
| Every P1–P6 item needed for launch done | ⬜ Owner | §1 above; the M12 items follow when funded |
| Launch needed no more than $5 of SOL in owner wallets | ✅ So far | §3 below |

## 3. SOL used so far in owner wallets (target ≤ 0.068 SOL, REWRITE-PLAN §7.2)

| Item | Mainnet SOL | Status |
|---|---|---|
| Sessions M0–M11 (code, tests, fork and devnet runs) | **0** | No session sent a mainnet transaction or signed with a funded key |
| Devnet deploy of Aroma Guard v1 (M6, owner) | 0 (devnet SOL) | Done 2026-11-14 |
| M10 Jupiter DCA spike | 0 | Path B: nothing spent |
| M11 features (notifications, P&L, onboarding, dashboard, fee-share ledger) | 0 | All off-chain; no fee account created (5a) |
| P5 spot tests on the beta | about 0.007 (planned) | Owner, not done; the only planned M11-era spend |
| **Total so far** | **0 recorded** | The owner confirms from the wallet history. With P5: about 0.007 SOL, within 0.068 |

**When funded (M12, not part of this launch):**
- the Aroma Guard program data account, about 2.47 SOL of refundable rent, locked;
- the upload buffer, a peak of about 4.97 SOL in the deployer;
- the config, asset and treasury accounts;
- the Squads multisig;
- the mainnet keeper's fee float;
- a platform fee's fee accounts, about 0.002 SOL each, only if option 5b is ever approved.

## 4. Success metrics (ROADMAP §4)

| Metric | Target | Measured at M11 | Who measures next |
|---|---|---|---|
| CI green on main | 100% | Not measured: never pushed | Owner (P6) |
| Installments executed within 5 minutes of due | ≥ 99% | Not measurable: 0 plan accounts on devnet (read-only `getProgramAccounts`, genesis checked) | Owner, after the devnet keeper runs; mainnet at M12 |
| Failed installments that trigger an alert | 100% | Every failure that reaches execution alerts (tested). Gap: an error before execution is logged and retried, with no alert | Owner on a devnet run |
| Time to first basket buy | < 2 min | **2.8 s** app time, fork E2E | Owner, from consent-gated analytics (`time_to_first_basket` bucket) |
| p95 of `/api/markets` (now `/markets` and `/api/v1/prices`) | < 300 ms | `/markets` **47 ms**. `/api/v1/prices`: 1,861 ms against keyless Jupiter, with 46 of 100 answering 502 | Owner, in production with the Jupiter key |
| Critical or High audit findings open at launch | 0 | 2 (H-7 and H-8, both P6) | Owner |

## 5. M11 decisions (taken in the session; the owner may revisit)

1. **Channels:** web push and Telegram. **Email off**: no email address is collected, so no Resend account is needed.
2. **No new dependency.** Web push is RFC 8291/8292 on `node:crypto`, checked against the RFC 8291 test vector. Telegram is the Bot API over `fetch`. QStash verification is not needed: the worker route takes a bearer secret.
3. **Cost basis:** Aroma receipts only, with exact fills read from the confirmed transactions. Every other holding is "cost basis unknown". No on-chain history parsing.
4. **On-ramps:** none linked. The page points to the wallet's own Buy feature and links no exchange or affiliate.
5. **Fee share:** 5a, accounting only. No platform fee; boot refuses a non-zero fee. 5b needs the owner's and counsel's approval.
6. **The opt-in challenge** lives in a separate module (`server/wallet-challenge.ts`). Frozen `server/auth/**` is unchanged; only its existing exports are reused.
