# Invariants

Each invariant names where the program enforces it and where it is tested. "Proptest" means Rust `proptest` with 2,000 cases per property, run by `cargo test`.

| # | Invariant | Enforced in | Tested by |
|---|---|---|---|
| I1 | **No value from nothing.** The mainnet binary contains no minting code; output reaches the owner only from a swap of funding that was actually pulled | `#[cfg(feature = "devnet-mock")]`; `scripts/check-build.mjs` checks the binaries | `check-build.mjs` (marker, `mock_mint` seed, Jupiter marker) |
| I2 | **Never more than `periods × funding_amount` is pulled**, whatever the timing or executor; executed + skipped ≤ periods | `math::runnable_period`, `leg_bitmap`, `common::begin_period` | proptest `never_pulls_more_than_periods_times_amount`, `schedules_pull_deliver_and_restore_staging`; LiteSVM schedule cases |
| I3 | Each pull moves **exactly** `funding_amount` from the owner's funding account into staging | `common::collect` (before/after on both accounts) | LiteSVM happy paths (both builds) |
| I4 | **Every accepted leg delivers at least `min_out`** to the owner's ATA, where `min_out = floor(expected_out(leg_funding) × (10,000 − slippage) / 10,000)` and `expected_out` is the oracle value rounded down (multiplier rounded up) | `swap_math::verify_swap`, `route.rs` | proptest (`delivered ≥ Σ min_out`), LiteSVM `amountOut ≥ minOut` on real routes, fork run |
| I5 | **Staging never ends a transaction below its start balance**, and is exactly back at it when a period completes | `verify_swap` (staging drops by exactly `leg_funding`), `finish_period` (`StagingNotRestored`) | proptest; LiteSVM N-leg-across-transactions; fork run |
| I6 | The swap authority's source and transit accounts end every leg at their **starting** balance | `verify_swap` | `swap_math` unit cases, proptest |
| I7 | A route can reach only the accounts it was given, and none of those is a plan, protocol, owner-funding or Subscriptions account, a plan-owned token account, or a swap-authority token account other than this leg's | `route::check_route_accounts` | LiteSVM `RouteAccountForbidden` cases |
| I8 | The only signer in the Jupiter CPI is the swap authority | `jupiter::route_instruction` | unit `instruction_signs_only_with_the_swap_authority` |
| I9 | A protocol fee never lowers `min_out`, and `fee + amount_in == leg_funding` | `swap_math::leg_terms` | proptest `fee_never_lowers_the_floor`; LiteSVM fee on/off |
| I10 | **Any failed leg reverts the whole transaction**, including the period's pull | transaction atomicity (no state is written before the last check) | LiteSVM `slippage failure on a later leg…` (owner, staging, plan bytes unchanged) |
| I11 | Mainnet execution is keeper-only, with price updates at most `min(max_oracle_staleness_s, 20)` seconds old | `common::entry_checks(…, true)`, `swap_math::effective_max_price_age` | LiteSVM decision-1 cases |
| I12 | Account layouts never change offsets; new fields only in `reserved` | sizes pinned in `tests.rs` | `sizes_are_explicit_and_match_init_space` (M8 added no fields) |
| I13 | Closing a plan always works (paused or not) and returns staging to the owner | `close_plan` (reads no config) | M6 LiteSVM, fork run (close + revoke) |
