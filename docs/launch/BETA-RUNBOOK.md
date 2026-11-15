# Private beta (`beta.<domain>`): owner runbook

_Prepared for the M11 tip on branch `m11-launch` (REWRITE-PLAN §7.3 phase D; first written for Phase A on `phase-a-beta`). **Every step below is the owner's.** No session created an account, deployed anything, or sent a mainnet transaction. Do the steps in order; each one says what it needs first._

**What the beta is (owner decision, 2026-11-15).** Spot purchases, baskets, creators, Blinks and the M11 features are live on Solana mainnet for invited wallets, with small caps. Recurring investing stays the labelled **devnet test** (M10 Path B). **Aroma Guard is not on mainnet**: that is M12, when it is funded and audited. Nothing in this runbook deploys a program.

## 1. Accounts (P3 minimum)

Create only what the beta needs ([PRODUCTION-ENV.md §5](./PRODUCTION-ENV.md#5-phase-a-betadomain-private-beta)):

- [ ] Vercel: a **separate project** for `beta.<domain>` (not the prototype's project), Git integration on `main` only.
- [ ] Domain: `beta.<domain>` pointed at that project.
- [ ] Mainnet RPC (Helius or Triton): a server key and a browser key locked to `https://beta.<domain>`. A second provider for `SOLANA_RPC_FALLBACK_URL` is recommended.
- [ ] Neon (Postgres): a production branch; the pooled connection string.
- [ ] Upstash Redis: eviction **off**. Upstash QStash: for the M11 periodic worker (step 4).
- [ ] Jupiter: an API key (portal.jup.ag).
- [ ] Sentry: a project; DSNs and a build-time auth token; alert rules to your channel.
- [ ] Cloudflare Turnstile: a site for `beta.<domain>` (the devnet faucet).
- [ ] **M11 notification channels** (both optional; see step 4): a Telegram bot from @BotFather, and VAPID keys for web push generated on your own machine. **No email provider**: M11 collects no email address (decision 1), so Resend is not needed.
- [ ] Secrets, each generated on a trusted machine and pasted straight into Vercel (never into a file in the repo):
  - `AROMA_TRADE_SECRET` and `AROMA_NOTIFY_WORKER_SECRET`: `openssl rand -base64 48` each;
  - `TELEGRAM_WEBHOOK_SECRET`: `openssl rand -hex 32`;
  - the VAPID pair: `pnpm --filter @aroma/web notify:vapid` prints both values to your terminal.
- [ ] Set the variables in Vercel:
  - the Phase A set: `AROMA_BETA_GATE=on`, `AROMA_MAX_TRADE_USDC_RAW=50000000`, `AROMA_MAX_DAILY_USDC_RAW=200000000`. **Do not** set `NEXT_PUBLIC_PRIVY_APP_ID` (v1 is wallet-only).
  - M11: `AROMA_NOTIFY_WORKER_SECRET`, and for each channel you turn on, **all** of its variables (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`; or `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` and `TELEGRAM_WEBHOOK_SECRET`). A half-set channel stops the boot.
  - Fees: leave `AROMA_PLATFORM_FEE_BPS` unset or `0` (anything else stops the boot: no platform fee is approved). `AROMA_CREATOR_FEE_SHARE_BPS` is optional and is recorded in the ledger only.
  - Analytics (optional): `NEXT_PUBLIC_PLAUSIBLE_DOMAIN=beta.<domain>`. Events are sent only after a visitor opts in.
- [ ] Check the environment:
  1. `vercel env pull` into a file **outside** the repo.
  2. `pnpm check:prod-env --profile beta --env-file <that file>`. It calls `getGenesisHash` on each RPC, read-only.
  3. Delete the file.

  The check must end `check:prod-env: OK`. Warnings for a channel you left off are expected.

## 2. Database

- [ ] From a trusted machine, with the Neon `DATABASE_URL` exported: `pnpm db:migrate`. It applies through **`0009_fee_share_ledger`**. All migrations are additive:
  - `0005_beta_access` (invites, access) and `0006_trade_caps` (caps), from Phase A;
  - `0007_notifications`: the subscription and event tables, and delivery columns on `notifications`. That table has never been written to, so its new `NOT NULL` column needs no backfill; on a table with rows the statement fails loudly instead;
  - `0008_purchase_channels`: Blink attribution;
  - `0009_fee_share_ledger`: accounting only.

## 3. Deploy `beta.<domain>` (needs P6 first)

- [ ] P6: the stack is pushed and merged to `main` with CI green ([MERGE-PLAN.md](./MERGE-PLAN.md)). The beta project builds from that merged tip, never from a local branch.
- [ ] Counsel's beta texts are in: terms, risk disclosures, the privacy notice's notification section, the P&L wording ([COMPLIANCE.md](./COMPLIANCE.md)).
- [ ] Deploy. The build runs the env check and the client-secret scan; both must pass.
- [ ] Open `https://beta.<domain>/api/v1/health`: RPC (mainnet genesis), Redis and Postgres `ok`.
- [ ] Every v1 page shows the "Private beta" banner; a wallet without access sees the redeem step in the ticket; the Action GET is disabled.
- [ ] `/get-started`, `/portfolio` (Profit and loss section), `/settings` (Notifications) and `/creators/dashboard` load.

## 4. M11 channels and the periodic worker

- [ ] **Worker:** in QStash, create a schedule `* * * * *` (every minute).
  - It POSTs `{}` with `Content-Type: application/json` to `https://beta.<domain>/api/v1/notifications/deliver`.
  - Add the header `Upstash-Forward-Authorization: Bearer <AROMA_NOTIFY_WORKER_SECRET>` so the route receives `Authorization: Bearer …`.
  - Each run writes the fee-share ledger and delivers due notifications.
  - Check one run in the QStash log: HTTP 200 with `{"paused":false,"ledger":…,"sent":…}`.
- [ ] **Telegram** (if on): register the webhook once, from your terminal:
  ```bash
  curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
    -d url=https://beta.<domain>/api/v1/notifications/telegram \
    -d secret_token=$TELEGRAM_WEBHOOK_SECRET -d 'allowed_updates=["message"]'
  ```
  - In @BotFather, set the bot's description to say it only sends Aroma notifications.
  - Test it: in `/settings`, turn Telegram on, open the link and press Start. The bot answers "Linked.", and "Send a test" arrives within a minute.
- [ ] **Web push** (if on): in `/settings`, turn browser push on in Chrome or Firefox and send a test.
  - Safari needs the site added to the Home Screen on iOS.
  - Not verified by any session on a real browser.
- [ ] **Pause:** `AROMA_NOTIFICATIONS=off` (redeploy) stops delivery and new opt-ins. The ledger keeps being written.

## 5. Issue invites

- [ ] From a trusted machine with the Neon `DATABASE_URL`: `pnpm --filter @aroma/web beta:invite --days 7 --uses 1`.
  - The code is printed **once** (only its SHA-256 is stored).
  - Send it to one tester privately. Repeat per tester.
- [ ] Creator invites: from `apps/web`, `pnpm exec tsx scripts/create-invite.ts --days 7` (same rules).
- [ ] Optional: a fixed wallet list in `AROMA_BETA_WALLETS` instead (no invite needed; redeploy to change it).

## 6. P5 spot tests: **owner, real money, later; not done by any session**

Before inviting testers, with your own funded wallet and small amounts (M4-DEPLOY.md §4):

- [ ] Buy one stock (for example $1–$5 of USDC). Check:
  - the receipt, the portfolio, the fees and the transaction on an explorer;
  - M11: the P&L row (cost basis = what you spent, quantity = the exact fill);
  - the notification, if a channel is on.
- [ ] Buy one three-stock basket the same way. Check its group under "Baskets bought through Aroma".
- [ ] Check the review showed "Beta limits: max $50 per trade, … left today", and that a $60 order is refused (`TRADE_CAP_EXCEEDED`, nothing signed).

**SOL needed (REWRITE-PLAN §7.2):** about **0.007 SOL** in that wallet:
- one new xStock token account per stock bought for the first time (measured 2026-11-14: 179–182 bytes, 0.00156–0.00157 SOL each, refundable rent), so four accounts for one stock and a three-stock basket;
- plus network fees.

It fits the $5 budget. M11 adds no SOL cost: notifications, P&L and the ledger are off-chain, and no fee account is created (5a). The USDC itself is the test amount.

## 7. Rollback, emergency stop, and Phase B

**Rollback a bad deploy:** Vercel → Deployments → the previous good deployment → *Instant Rollback*. Migrations `0005`–`0009` are additive, so an older build runs on the newer schema; never roll the database back.

**Emergency stop of trading:** set `AROMA_TRADING=off` and redeploy.
- Every mainnet trading entry point (quote, submit, Action POST) answers 503 `TRADING_UNAVAILABLE` in middleware and in each route.
- Browsing, receipts, P&L and plan closes stay open.
- Or remove access for wallets with `DELETE FROM beta_access WHERE wallet = '<address>'`, and remove them from `AROMA_BETA_WALLETS`.
- Trading also stops by itself, fail closed, if Postgres is unreachable (503 `BETA_ACCESS_UNAVAILABLE`).

**Notifications:** set `AROMA_NOTIFICATIONS=off` and redeploy, or pause the QStash schedule. Telegram users can send `/stop` at any time.

**Phase B (public spot launch):**

1. Counsel confirms the caps (keep or raise `AROMA_MAX_TRADE_USDC_RAW` and `AROMA_MAX_DAILY_USDC_RAW`; they always apply).
2. Set `AROMA_BETA_GATE=off` **explicitly** (unset means on in production) and redeploy. The banner and the redeem step disappear; the Action GET is enabled again.
3. Run `pnpm check:prod-env` (production profile) against the production env.
4. The invite and access tables stay (history); nothing reads them while the gate is off.
