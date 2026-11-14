# Phase A private beta: owner runbook

_Prepared on branch `phase-a-beta` (REWRITE-PLAN §7.3, phase A). **Every step below is the owner's.** No session created an account, deployed anything, or sent a mainnet transaction. Do the steps in order; each one says what it needs first._

## 1. Accounts (P3 minimum)

Create only what the beta needs ([PRODUCTION-ENV.md §5](./PRODUCTION-ENV.md#5-phase-a-betadomain-private-beta)):

- [ ] Vercel: a **separate project** for `beta.<domain>` (not the prototype's project), Git integration on `main` only.
- [ ] Domain: `beta.<domain>` pointed at that project.
- [ ] Mainnet RPC (Helius or Triton): a server key and a browser key locked to `https://beta.<domain>`.
- [ ] Neon (Postgres): a production branch; the pooled connection string.
- [ ] Upstash Redis: eviction **off**.
- [ ] Jupiter: an API key (portal.jup.ag).
- [ ] Sentry: a project; DSNs and a build-time auth token; alert rules to your channel.
- [ ] Cloudflare Turnstile: a site for `beta.<domain>` (the devnet faucet).
- [ ] `AROMA_TRADE_SECRET`: `openssl rand -base64 48`, pasted straight into Vercel (never into a file in the repo).
- [ ] Set the variables in Vercel, including `AROMA_BETA_GATE=on`, `AROMA_MAX_TRADE_USDC_RAW=50000000`, `AROMA_MAX_DAILY_USDC_RAW=200000000`. **Do not** set `NEXT_PUBLIC_PRIVY_APP_ID` (v1 is wallet-only).
- [ ] Check: `vercel env pull` into a file **outside** the repo, then `pnpm check:prod-env --profile beta --env-file <that file>` (it calls `getGenesisHash` on each RPC, read-only), then delete the file. It must end `check:prod-env: OK`.

## 2. Database

- [ ] From a trusted machine, with the Neon `DATABASE_URL` exported: `pnpm db:migrate`. It applies through `0006_trade_caps` (`0005_beta_access` adds the beta invite and access tables; `0006` the cap tables). Both are additive: no existing table changes.

## 3. Deploy `beta.<domain>` (needs P6 first)

- [ ] P6: the stack is pushed and merged to `main` with CI green ([MERGE-PLAN.md](./MERGE-PLAN.md)). The beta project builds from that merged tip, never from a local branch.
- [ ] Deploy. The build runs the env check and the client-secret scan; both must pass.
- [ ] Open `https://beta.<domain>/api/v1/health`: RPC (mainnet genesis), Redis and Postgres `ok`.
- [ ] Every v1 page shows the "Private beta" banner; a wallet without access sees the redeem step in the ticket; the Action GET is disabled.

## 4. Issue invites

- [ ] From a trusted machine with the Neon `DATABASE_URL`: `pnpm --filter @aroma/web beta:invite --days 7 --uses 1`. The code is printed **once** (only its SHA-256 is stored); send it to one tester privately. Repeat per tester.
- [ ] Optional: a fixed wallet list in `AROMA_BETA_WALLETS` instead (no invite needed; redeploy to change it).

## 5. P5 spot tests: **owner, real money, later; not done by any session**

Before inviting testers, with your own funded wallet and small amounts (M4-DEPLOY.md §4):

- [ ] Buy one stock (for example $1–$5 of USDC). Check the receipt, the portfolio, the fees and the transaction on an explorer.
- [ ] Buy one three-stock basket the same way.
- [ ] Check the review showed "Beta limits: max $50 per trade, … left today", and that a $60 order is refused (`TRADE_CAP_EXCEEDED`, nothing signed).

**SOL needed (REWRITE-PLAN §7.3):** about **0.007 SOL** in that wallet: one new xStock token account per stock bought for the first time (measured 2026-11-14: 179–182 bytes, 0.00156–0.00157 SOL each, refundable rent), so four accounts for one stock and a three-stock basket, plus network fees. It fits the $5 budget (§7.2). The USDC itself is the test amount.

## 6. Rollback, emergency stop, and Phase B

**Rollback a bad deploy:** Vercel → Deployments → the previous good deployment → *Instant Rollback*. Migrations `0005` and `0006` are additive, so an older build runs on the newer schema; never roll the database back.

**Emergency stop of trading:** set `AROMA_TRADING=off` and redeploy: every mainnet trading entry point (quote, submit, Action POST) answers 503 `TRADING_UNAVAILABLE` in middleware and in each route, while browsing, receipts and plan closes stay open (M9; it replaced the old `AROMA_V1_ENABLED=false` stop). Or remove access for wallets with `DELETE FROM beta_access WHERE wallet = '<address>'` and remove them from `AROMA_BETA_WALLETS`. Trading also stops by itself, fail closed, if Postgres is unreachable (503 `BETA_ACCESS_UNAVAILABLE`).

**Phase B (public spot launch, M9):**

1. Counsel confirms the caps (keep or raise `AROMA_MAX_TRADE_USDC_RAW` and `AROMA_MAX_DAILY_USDC_RAW`; they always apply).
2. Set `AROMA_BETA_GATE=off` **explicitly** (unset means on in production) and redeploy. The banner and the redeem step disappear; the Action GET is enabled again.
3. Run `pnpm check:prod-env` (production profile) against the production env.
4. The invite and access tables stay (history); nothing reads them while the gate is off.
