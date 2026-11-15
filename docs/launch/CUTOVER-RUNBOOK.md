# Public spot launch (Phase B, M9): owner runbook

_Prepared on branch `phase-b-cutover` (REWRITE-PLAN §7.3 phase B, §9). **Every step below is the owner's.** No session created an account, deployed anything, changed DNS, or sent a mainnet transaction. Do the steps in order; each one says what it needs first and what it costs in SOL._

**SOL budget (REWRITE-PLAN §7.2):** the whole runbook costs **nothing beyond network fees, except step 8 (P5), about 0.007 SOL** in your own test wallet. Users pay their own fees and token-account rent. No program is deployed.

## 1. Phase A beta ran and its findings are closed

- [ ] The private beta on `beta.<domain>` ran with invited testers ([BETA-RUNBOOK.md](./BETA-RUNBOOK.md)).
- [ ] Every finding from it is fixed or explicitly accepted, and the fixes are merged.
- [ ] The Jupiter route-schema finding is resolved: today the trade server refuses (fail closed) any route Jupiter builds through a DEX the reviewed schema does not know (AAPLx in Phase A; routes through BisonFi in Phase B). Refresh and review the schema in `packages/guard/src/jupiter` before opening, or accept that those stocks are not buyable yet.

SOL: none.

## 2. Counsel's final texts are in (HARD GATE)

**No public launch on placeholder legal text.** Everything below is placeholder today ([COMPLIANCE.md §4](./COMPLIANCE.md#4-what-counsel-must-supply-needs-counsels-final-text)):

- [ ] Terms of use: a new `final: true` version in `features/compliance/terms.ts` and the terms page (every wallet re-accepts).
- [ ] The acceptance line the wallet signs (`features/compliance/server/terms.ts`).
- [ ] Risk disclosures per surface (`features/compliance/disclosures.ts`; bump `DISCLOSURE_VERSION`).
- [ ] The final restricted-country list (`AROMA_COMPLIANCE_RESTRICTED_COUNTRIES`), and whether sub-national regions must be blocked (not implemented: it needs `x-vercel-ip-country-region`).
- [ ] Beta and cap wording; the caps for the public launch (`AROMA_MAX_TRADE_USDC_RAW`, `AROMA_MAX_DAILY_USDC_RAW`: keep or raise).
- [ ] Notice-page and blocked-state wording.

SOL: none.

## 3. P6: push, CI green, `main` protected, production deploys from `main`

- [ ] Push the stack in order and fast-forward `main` ([MERGE-PLAN.md](./MERGE-PLAN.md) §1–§3; the linearity check now ends `phase-a-beta → phase-b-cutover`).
- [ ] CI green on GitHub: `ci.yml` (required), and run `e2e.yml`, `lighthouse.yml` and `contracts.yml` once by hand (they are path-filtered and nightly; never run on GitHub yet).
- [ ] Protect `main` (MERGE-PLAN §4 `gh api` commands).
- [ ] The production Vercel project builds from `main` only. Tag the old prototype deploy `prototype-final` (already exists locally; push it first, MERGE-PLAN §3).

SOL: none.

## 4. P3: every production account and key for spot

Every variable, where to get it and the plan: [PRODUCTION-ENV.md](./PRODUCTION-ENV.md) §1 and §4.

- [ ] Paid mainnet RPC (server key) **and a second provider for failover** (`SOLANA_RPC_FALLBACK_URL`; a different provider, not another key on the same host).
- [ ] Browser RPC key, origin-locked to the production domain.
- [ ] Neon (Launch plan), `pnpm db:migrate` from a trusted machine (through `0006_trade_caps`).
- [ ] Upstash Redis with eviction off; Jupiter API key; Jito URL; Sentry (DSNs, auth token, alert rules); Turnstile for the production domain; operator name and support email.
- [ ] `AROMA_SITE_URL=https://<production domain>`; `AROMA_TRADING=on` (or unset).
- [ ] Check: `vercel env pull` into a file **outside** the repo, then `pnpm check:prod-env --env-file <that file>` (production profile: it calls `getGenesisHash` on both server RPCs and the browser RPC, read-only), then delete the file. It must end `check:prod-env: OK`; `AROMA_BETA_GATE` still warns until step 9.

SOL: none.

## 5. P4: `AROMA_TRADE_SECRET` rotation drill on production

- [ ] Run the rotation once on production before launch ([KEY-CUSTODY.md §3](./KEY-CUSTODY.md#3-aroma_trade_secret-rotation)): new key with the old one as `AROMA_TRADE_SECRET_PREVIOUS`, deploy, wait 20 minutes, remove the previous key, deploy. `check:prod-env` warns while a previous key is set.

SOL: none.

## 6. Keep the prototype on an archived URL for 30 days; announce the switch

- [ ] Deploy the `prototype-final` tag to an archive URL (for example `archive.<domain>`), read-only notice on it, kept 30 days from the tag.
- [ ] Announce the switch date on the current site and your channels. Old links keep working on the new site: `/landing`, `/app`, `/sip`, `/basket/builder`, `/orders` and every `/v1/*` URL redirect 308; old prototype APIs (including shared Blinks on `/api/actions/*`) answer 410 with a clear message.

SOL: none.

## 7. Point the production domain at v1 (owner: DNS)

- [ ] In Vercel, assign the production domain to the v1 project. DNS changes are yours.
- [ ] Open `https://<domain>/api/v1/health`: RPC (both endpoints: `primary` and `fallback` `ok`, `fallbackInUse: false`), Redis and Postgres `ok`.
- [ ] Spot-check headers once: `curl -sI https://<domain>/ | grep -iE 'content-security-policy|strict-transport-security'` shows the nonce CSP and HSTS with preload.

SOL: none.

## 8. P5: spot tests on the production domain, with small amounts, before any announcement

**The owner's real-money tests; no session does them.** With your own funded wallet ([M4-DEPLOY.md §4](../M4-DEPLOY.md)):

- [ ] Buy one stock (about $1–$5 of USDC): check the receipt, the portfolio (`/portfolio#activity`), the fees and the transaction on an explorer.
- [ ] Buy one three-stock basket the same way.
- [ ] Check a quote above the per-trade cap is refused with nothing to sign.
- [ ] Check `/settings` shows the wallet's terms status.

SOL: **about 0.007 SOL** (one new xStock token account per stock bought for the first time, 0.00156–0.00157 SOL each, refundable rent, plus fees). The USDC is the test amount.

## 9. Open to the public: `AROMA_BETA_GATE=off`

- [ ] Set `AROMA_BETA_GATE=off` **explicitly** (unset means on in production) and redeploy. The beta banner and the redeem step disappear; the Action GET is enabled.
- [ ] `pnpm check:prod-env` (production profile) shows `AROMA_BETA_GATE: off (public launch)` and ends OK.

SOL: none.

## 10. Monitoring

- [ ] An uptime check on `GET /api/v1/health` (alert on 503 and on `status: degraded` for longer than a few minutes).
- [ ] Sentry alert rules: web errors; `quote.refused` / `submit.refused` spikes; **`alert rpc.wrong_cluster`** (page immediately: an RPC endpoint reports another cluster); a sustained rate of **`rpc.fallback_served`** (the primary RPC is failing).
- [ ] The Jupiter key's quota (keyless or exhausted keys refuse every quote).
- [ ] Optional, owner only: register the Actions with a Blink registry so basket links unfurl on X.

SOL: none.

## 11. Rollback

- **A bad deploy:** Vercel → Deployments → the previous good deployment → *Instant Rollback*. Migrations through `0006` are additive; never roll the database back.
- **Stop trading, keep the site up:** set `AROMA_TRADING=off` and redeploy. Quote, submit and the Action POST answer 503; browsing, receipts and plan closes stay open.
- **Back to the prototype:** point DNS back at the archive deployment from step 6.

SOL: none.

## 12. M11 launch features (added for the M11 tip)

Do these with steps 4, 8 and 10; they ran first on `beta.<domain>` ([BETA-RUNBOOK.md](./BETA-RUNBOOK.md) §4).

- [ ] **Counsel** reviewed the M11 wording ([COMPLIANCE.md](./COMPLIANCE.md) §6):
  - the notification section of the privacy notice;
  - the notification messages;
  - the P&L wording ("information, not advice");
  - the onboarding page;
  - the creator dashboard's fee-share line.
- [ ] **Migrations** through `0009_fee_share_ledger` on the production database (step 4).
- [ ] **Channels** for the production domain:
  - a production Telegram bot (or the beta one, with the webhook moved to the production URL);
  - VAPID keys generated for the production deployment. New keys mean beta push subscriptions do not carry over: users turn push on again;
  - `AROMA_NOTIFY_WORKER_SECRET` and the QStash schedule pointed at `https://<domain>/api/v1/notifications/deliver`.
- [ ] `pnpm check:prod-env` (production profile) shows each channel you turned on as `ok`, and `AROMA_PLATFORM_FEE_BPS` unset or `0`.
- [ ] **P5 on production** (step 8):
  - the P&L row of the test stock (cost basis = the amount spent, quantity = the exact fill);
  - a notification for the test purchase on each channel you turned on;
  - `/creators/dashboard` for a creator wallet.
- [ ] **Monitoring** (step 10):
  - the QStash schedule's failures;
  - the `notify worker run` log lines (`dead` growing means a channel is failing);
  - Sentry errors from `v1/notifications/*`.
- [ ] **Rollback:** `AROMA_NOTIFICATIONS=off` pauses notifications without touching trading; `AROMA_TRADING=off` stops trading without touching notifications.
- [ ] **Not in this launch:**
  - a platform fee and creator payouts (5b: needs the owner's and counsel's approval, and its own reviewed trade-path change);
  - email notifications;
  - on-ramp links;
  - Aroma Guard on mainnet (M12).

SOL: none (5a creates no fee account).
