# Keeper operations (Ovelo Guard v1, devnet)

The keeper (`apps/keeper`, `@ovelo/keeper`) executes due recurring-plan installments. It is a stateless HTTP service: QStash calls `POST /run` every 1–5 minutes, and each run reads everything it needs from the chain, Postgres (`plans_index`, `receipts`) and Redis (leases, dead letters, alert de-duplication). It runs on **devnet only** until Ovelo Guard reaches mainnet at M12 (audit, multisig and deploy, when funded). M10 took Path B: no mainnet recurring through Jupiter DCA ([launch/DCA-SPIKE.md](./launch/DCA-SPIKE.md)).

## How a run works

1. **Signature.** `POST /run` verifies the `Upstash-Signature` JWT (HS256) with `QSTASH_CURRENT_SIGNING_KEY`, then `QSTASH_NEXT_SIGNING_KEY`; the `sub` claim must be `KEEPER_PUBLIC_URL`, the `body` claim must hash the raw body, `exp`/`nbf` within 60 s of skew. Anything else is 401 and nothing runs. One run at a time per instance (a second call is 409; QStash retries).
2. **Cluster.** The RPC's genesis must be devnet's (or, for a local test run only, the configured local validator's; never mainnet's). Checked at boot (the process exits) and for every RPC client.
3. **Health.** RPC latency (> 3 s alerts `rpc_degraded`), the keeper's SOL balance (below `KEEPER_MIN_SOL_LAMPORTS`, default 0.5 SOL, alerts `keeper_balance_low`), and the config: the keeper key must be `keeper_authority`, otherwise the run stops.
4. **Reconcile (the reconcile job).** Every v1 plan on chain (`getProgramAccounts`, discriminator filter) is mirrored into `plans_index`; missing, stale and orphan rows are repaired and each drift is logged (`plans_index drift repaired`). The chain is the source of truth.
5. **Due plans.** Active rows with `next_due_at <= chain time`, oldest first, at most `KEEPER_MAX_PLANS_PER_RUN`. Each plan is re-read from chain before anything is signed.
6. **One plan.** Redis lease `lease:plan:{pda}:{period}` (SET NX, 3 minutes; compare-and-delete release). The period is always the **oldest runnable** one (the program refuses any other). Periods that fell out of the catch-up window are counted as skipped by that execution and alerted (`installment_skipped`). Legs run in batches of at most three (`leg_mask`). Per batch:
   - owner output and treasury token accounts, if missing (keeper pays);
   - a fresh Hermes update for the batch's feeds, refused if any `publish_time` is older than `max_oracle_staleness_s − 10 s` (alerted `hermes_unavailable`; the installment is **deferred**, not dead-lettered);
   - Wormhole VAA verification (`init/write/verify_encoded_vaa`, 1 transaction for a small VAA, 2 for 13–19 guardian signatures), then **one `post_update` per feed per transaction**, each a fully verified `PriceUpdateV2` written by the keeper;
   - `execute_installment`, then cleanup (close the encoded VAA, reclaim price-update rent).
   Every transaction is simulated, sent and confirmed. The receipt (`receipts.kind = installment`, with `plan_pda` and `period`) is written from the transaction's own `InstallmentExecuted` event; `plans_index` is updated from the re-read plan.
7. **Dead letters.** A program refusal in simulation (permanent) or exhausted retries go to the Redis list `keeper:dlq` and alert `installment_failed`. If the list grew past `KEEPER_DLQ_ALERT_THRESHOLD`, `dead_letter_growth` fires.

Why posts are separate transactions: a `post_update` instruction is about 580 bytes (message + 12-node proof + accounts), and a 1-leg `execute_installment` is 800 bytes, so even one post plus execute is 1,377 bytes, over the 1,232-byte limit. A 3-leg period costs 7 transactions (2 VAA, 3 posts, 1 execute, 1 cleanup). The price accounts are written only by this keeper (write authority) and the program re-checks verification level, feed id, staleness and confidence, so splitting them costs fees, not safety.

## Retries and idempotency

Transient failures (RPC errors, timeouts, an expired blockhash) retry with exponential backoff (500 ms × 2^attempt + jitter, `KEEPER_MAX_ATTEMPTS`, default 3), rebuilding with a fresh blockhash each time. A duplicate landing is impossible: the program's period and leg bitmap is the final guard, the lease keeps two runs apart, and receipts are insert-once by signature.

## Schedules

QStash schedule (owner step, after the QStash account exists): a POST to `KEEPER_PUBLIC_URL` every minute (`* * * * *`) or up to every 5 minutes. With 15-minute or longer periods a 5-minute schedule is enough; with the catch-up window of 1, a period can still run during the whole next period. Stock feeds update in US market hours, so a daily or weekly plan's installment runs when Hermes has a fresh price; outside market hours it is deferred (and alerted), and skipped only if a whole window passes.

## Alerts

To `KEEPER_ALERT_WEBHOOK_URL` in Slack (`text` + `blocks`) or Discord (`content`) format (`KEEPER_ALERT_FORMAT`). The same (kind, subject) is sent once per window (failed and balance: 1 h; skipped: 24 h; Hermes and RPC: 15 min; dead-letter growth: 1 h); at most 20 alerts per minute leave in total. Every alert is also a `keeper alert` log line. A webhook failure is logged, never thrown into the run.

| Kind | Subject | Meaning |
|---|---|---|
| `installment_failed` | plan:period | dead-lettered (program refusal or retries exhausted) |
| `installment_skipped` | plan:periods | periods missed the catch-up window |
| `keeper_balance_low` | keeper address | top up devnet SOL |
| `hermes_unavailable` | stale / unauthorized / unreachable / malformed | installments deferred |
| `rpc_degraded` | connect / latency | RPC down, slow, or on the wrong cluster |
| `dead_letter_growth` | count | the dead-letter list grew |

## Dead-letter CLI

```bash
cd apps/keeper
pnpm cli dlq list                 # newest first: id, plan, period, leg mask, code, error, attempts
pnpm cli dlq replay <id>|all      # re-run the plan now; removed when executed or no longer due
pnpm cli dlq drop <id>            # after handling it by hand
pnpm cli reconcile                # mirror every plan on chain into plans_index
pnpm cli run [url]                # a signed direct call to POST /run with the current key
```
The CLI reads the same environment as the server.

## Runbooks

- **`installment_failed` with `PROGRAM_ERROR`.** Read the logs in the alert/dead letter. Usual causes: the owner's test USD balance is below the installment (the owner tops up; the period may then be skipped), the plan or config was paused, an asset was disabled, or the delegation was revoked outside Ovelo. Fix the cause, then `dlq replay <id>`; if the period is gone, `dlq drop <id>`.
- **`RETRIES_EXHAUSTED`.** RPC trouble: check `rpc_degraded`, switch `KEEPER_RPC_URL` to a healthy devnet endpoint, `dlq replay all`.
- **`hermes_unavailable: unauthorized`.** The Pyth API key is missing or revoked: set `PYTH_API_KEY`. **`stale`** outside US market hours is expected for equity feeds.
- **`keeper_balance_low`.** `solana airdrop 2 <keeper> --url devnet` (devnet only). Each 3-leg installment costs a few transactions' fees plus temporarily the encoded-VAA and price-update rent, returned by cleanup.
- **Cleanup failed (warning in the log).** The encoded VAA or price-update rent stays with the keeper's accounts until reclaimed; it never affects the installment.
- **`plans_index drift repaired` in every run.** Some writer is not updating the index (a submit failure after confirmation, or an outside executor when `keeper_authority` is `None`). The reconcile repairs it; find the writer.
- **Wrong cluster at boot.** The RPC is not devnet. The process refuses to start by design; never point the keeper at mainnet.

## Key rotation

- **Keeper key** (devnet-only server secret `KEEPER_KEYPAIR`). Generate a new devnet key, fund it, have the admin call `update_config` with the new `keeper_authority` (owner step, the deployer signs on devnet), then deploy the keeper with the new secret. Between the config change and the deploy, runs stop with "not the configured keeper_authority" (safe: nothing is signed). Never reuse a devnet key on mainnet.
- **QStash signing keys.** QStash rotates current → next. Deploy with both; the keeper accepts either, so a rotation never drops a run. After QStash promotes `next`, set the new pair.
- **Hermes key, webhook URL, Upstash token, database URL.** Replace the secret and redeploy; no state depends on them.

## Local run against devnet

Without a hosted URL (`KEEPER_PUBLIC_URL` unset), run the keeper on this machine against devnet; QStash cloud cannot reach it, so trigger it with signed direct calls. The CLI signs exactly like QStash (HS256 with `QSTASH_CURRENT_SIGNING_KEY`), so the signature path is the same one production uses.

```bash
cd apps/keeper
node --env-file=.env --import tsx src/server.ts            # boot checks devnet genesis and the keeper key, then listens on :8787
while true; do node --env-file=.env --import tsx src/cli.ts run http://127.0.0.1:8787/run; sleep 60; done   # one signed run per minute
```
Equity feeds publish only in US market hours (Mon–Fri 9:30–16:00 ET): outside them every installment is deferred with `hermes_unavailable: stale`, as designed. To make a period skip on purpose, stop the trigger loop for longer than one period plus the catch-up window (window 1: two periods).

## Environment

See `apps/keeper/src/env.ts` (validated at boot; values never logged) and [M4-DEPLOY.md §6](./M4-DEPLOY.md). Logs are JSON (pino) with secret-named fields and any 64-byte key shape redacted.
