# M3 → M2: requests for `apps/web/lib/sdk`

M3 (read-only app) consumed `lib/sdk` but could not edit it. All items are now resolved (M4, Part A3). Each item says what M3 needed, how it works around the gap today, and what would let the workaround go. Newest last.

| # | Status | Module | Request |
|---|---|---|---|
| 1 | **Resolved by M2** (`9f5ae9a`) | `research/bars.ts` | Strict-clean under `noUncheckedIndexedAccess` |
| 2 | **Resolved in M4** (Part A3) | `baskets/performance/history.ts` | Option to never fall back to the token price |
| 3 | **Resolved in M4** (Part A3) | `baskets/performance/{history,growth}.ts` | List Pyth as a source only when a Pyth price was used |
| 4 | **Resolved in M4** (Part A3) | `markets/{catalog,http}.ts` | Report Jupiter rate limiting as its own warning |

## 1. `research/bars.ts` strict-clean: resolved

Importing `getStockResearch` pulled `bars.ts` (16 `noUncheckedIndexedAccess` errors) into the strict project. M3 briefly used a typing shim mapped only in `tsconfig.strict.json`. After rebasing onto `m2-shared-helpers`, `lib/sdk/research/**` is in the strict project and clean, so the shim was deleted (`4497ca6`).

## 2. Basket history: no token-price fallback

`fetchBasketHistoricalPerformance` computes each constituent's end price as `dateMap.get(endDate) ?? asset.priceUsd ?? asset.underlyingPriceUsd`. When the last daily close is missing, a **token** price (or a reference quote) is divided by a **share** start price. The two are different instruments, so the resulting change and the basket index mix two price series.

- **Workaround in M3:** `features/baskets/normalize.ts` `historyInput` passes identity and weights only (`priceUsd: null`, `underlyingPriceUsd: null`). A constituent without a last close is then reported as "No history" instead of being mixed.
- **Request:** an option such as `{ endPrice: "history-only" }`, or make history-only the default and expose the mixed figure separately and labelled.
- **Resolution (M4):** history-only is now the only behaviour. Start and end prices are observed daily closes; a constituent with no closes has no change and no `currentPriceUsd`. A range with no bars, or fewer than two observed dates, is `unavailable` with no 24h token data substituted (previously the "fewer than two dates" case returned 24h token changes labelled as the requested range, with status `partial`). The prototype's `/api/baskets/performance` shares this function, so it shows "unavailable" in those cases instead of mixed figures. `historyInput` no longer nulls prices. Tests: `history.test.ts` ("never substitutes a token price…", "no bars at all…", "a single observed date…"), `features/baskets/performance-view.test.ts` (real sdk, no mock).

## 3. Basket history: accurate source list

`history.ts` adds `"Pyth Network Reference Feeds"` to `sources` whenever a feed **exists** for a constituent's symbol, whether or not any Pyth price fed the result. PRODUCT.md requires every figure to name its real source.

- **Workaround in M3:** `toPerformanceView` drops Pyth from `sources`. This is safe only because M3 passes no prices (see #2).
- **Request:** add the source only when a Pyth observation actually contributed.
- **Resolution (M4):** the history path returns `["Yahoo Finance Daily Closes"]` when at least one constituent was priced and `[]` otherwise; it never lists Pyth (no Pyth observation feeds daily history). The 24h path (`growth.ts`) lists Jupiter or Pyth only for constituents whose 24h change was used, and no longer lists "Pyth Network Reference Feeds" because a feed exists. `toPerformanceView` passes `sources` through unchanged.

## 4. Catalog warnings: name rate limiting

Without `JUPITER_API_KEY`, the keyless Jupiter API rate-limits a full catalog refresh (about 1,600 mints). The result is a `partial` snapshot where most assets are unpriced, with the generic warning "Some Jupiter prices and token metadata are unavailable".

- **Workaround in M3:** none needed: the warning is shown verbatim and unpriced assets say "No token price".
- **Request:** a distinct warning when the cause is HTTP 429, so operators can tell "configure an API key" from "provider down". For production, set `JUPITER_API_KEY` (M4 deploy checklist).
- **Resolution (M4):** `markets/http.ts` throws `MarketHttpError` (with `status`) and exports `isRateLimited`. When a Jupiter batch still gets 429 after the one paced retry, the snapshot carries `JUPITER_RATE_LIMITED_WARNING` instead of the generic message. Test: `markets/rate-limit-warning.test.ts`.
