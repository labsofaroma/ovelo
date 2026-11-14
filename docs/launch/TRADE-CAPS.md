# Per-trade and per-day caps (Phase A, W3)

_Branch `phase-a-beta`. REWRITE-PLAN §7.3 **W3**. Nothing here is deployed._

## 1. Configuration

| Variable | Unit | Beta value | Rules |
|---|---|---|---|
| `AROMA_MAX_TRADE_USDC_RAW` | raw USDC (6 decimals) | `50000000` ($50) | whole number > 0, ≤ u64 |
| `AROMA_MAX_DAILY_USDC_RAW` | raw USDC, per wallet per UTC day | `200000000` ($200) | whole number > 0, ≥ the per-trade cap |

Parsed to `bigint` (`features/caps/config.ts`). Unset outside production: the beta values. **Unset or 0 in production stops boot** (`server/env.beta.ts`, VERCEL_ENV=production with v1 on) and, at runtime, every capped request fails closed (503 `TRADE_CAP_UNAVAILABLE`). `pnpm check:prod-env` lists both as required. The caps apply whether the beta gate is on or off (Phase B raises or keeps them per counsel).

## 2. Notional

The order's **maximum funding debit**, the amount the trade authorization carries (for a basket, the total across all legs). USDC counts 1:1; USDT and SOL are valued with the existing price path (Jupiter Price V3, fetched for the check, so fresh) in bigint fixed-point, rounded up. No price → refused (`TRADE_CAP_UNAVAILABLE`), never guessed (`features/caps/server/notional.ts`).

## 3. Enforcement

| Where | What |
|---|---|
| Quote (`POST /api/v1/trade/quote`) | A pre-check on the amount asked for (no route is built above the cap), then the check that counts on the authorized maximum debit: above the per-trade cap → 422 `TRADE_CAP_EXCEEDED`; today's used amount + this order above the daily cap → 422 `DAILY_CAP_EXCEEDED`. The response carries `limits` (per-trade, daily, used, remaining, notional, day) for the review. |
| Submit (`POST /api/v1/trade/submit`) | Per-trade re-check on the verified authorization's receipt, then an **atomic reservation** for the wallet and UTC day, keyed by the authorization's `request_id` (a replay inserts nothing and counts nothing). Released when the trade fails or provably never landed; kept when it confirms. |
| Status (`GET /api/v1/trade/:id`) | A final status settles the reservation (idempotent). |
| Stale reservations | Still `reserved` 5 minutes after the quote expired: checked against the chain at the wallet's next quote or submit (read-only): confirmed → kept; error, never claimed, or past the blockhash's last valid height with no status → released; anything undecidable keeps counting (fail closed). |
| Action POST | Blink clients send the transaction themselves, so Aroma never sees a submit or a failure: the Action's notional is reserved at quote time and **kept for the day**, sent or not (conservative). |

The cap counts the **wallet**, never the IP.

## 4. Why Postgres, not Redis `INCRBY`

- The daily total must be durable: Upstash eviction or a flush would silently reset it, and a guard in Redis needs a Lua script plus a separate idempotency key.
- The beta gate already needs Postgres, so this adds no new failure mode.
- One transaction ties the reservation row (primary key `request_id`) to the total, which moves only with `UPDATE … SET used_raw = used_raw + n WHERE used_raw + n <= cap`. Postgres row-locks it, so parallel submits at the edge of the cap queue and re-check.

Migration `0006_trade_caps`: `trade_cap_days` (wallet, day, `used_raw numeric(20,0)`), `trade_cap_reservations` (`request_id` PK, wallet, day, `amount_raw numeric(20,0)`, status, `resolve_after`). `numeric(20,0)` is an exact integer that fits a u64 (the one place amounts are not `text`: the database must add and compare them in one statement); Drizzle returns it as a string, read with `BigInt()`.

## 5. UI

The review shows "Beta limits: max $50 per trade, $X left today (UTC, before this trade)" from the quote's `limits`; nothing is computed or invented in the browser. Over the cap, the ticket shows the coded error's message (with the configured figure and what is left).

## 6. Tests

`features/caps/config.test.ts`, `server/notional.test.ts` (including a property: never undervalued), `server/store.test.ts` (PGlite: replay, settle, edge-of-cap parallel, and a fast-check property that no sequence of submit, replay, fail and confirm lets the confirmed or counted total pass the cap; bigint only), `server/store.postgres.test.ts` (25 parallel reservations on 25 connections: exactly 4 × $50 fit $200), `features/trade/server/outcome.test.ts`, `features/caps/routes.test.ts`, `ReviewPanel.limits.test.tsx`, and the fork E2E `e2e/trade/caps.spec.ts`.
