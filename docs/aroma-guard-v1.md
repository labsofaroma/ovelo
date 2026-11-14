# Aroma Guard v1

The on-chain program behind Aroma's recurring investing: an owner approves a bounded recurring grant, and each period the program turns exactly one installment of funding into the plan's assets at a price bounded by Pyth, delivered to the owner's own token accounts.

| | |
|---|---|
| Program ID | `FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU` (fixed by the program keypair; not deployed yet) |
| Source | `packages/contracts/programs/aroma_guard` (Anchor 1.2.1, Agave 3.1.10, SBPF v0) |
| IDL and client | `packages/guard/src/v1/` (`@aroma/guard`: `idl/`, Codama-generated `generated/`, hand-written builders; the web app re-exports it as `@/lib/sdk/guard/v1`) |
| Spec | [CONTRACT-V1-SPEC.md](./CONTRACT-V1-SPEC.md) |
| Devnet runbook | [M6-DEVNET-DEPLOY.md](./M6-DEVNET-DEPLOY.md) |
| Integrations | Solana Foundation Subscriptions `De1egAF…avR44` (layout pinned at `program-v0.5.0`), Pyth receiver `rec5EKM…LtFJ` (`pyth-solana-receiver-sdk` 2.0.0) |

## Two builds

| | devnet build (`--features devnet-mock`) | mainnet build (default) |
|---|---|---|
| `execute_installment` | mints the oracle amount from a per-asset PDA; funding goes to the treasury | fails closed with `MainnetExecutionUnavailable` until the Jupiter path (M8) |
| Minting code | present | absent: `scripts/check-build.mjs` proves from the binaries that neither the devnet marker nor the `mock_mint` seed is in the default build |
| `register_asset` | the mint authority must be the asset's `["mock_mint", mint]` PDA | issuer mints (no mint-authority requirement) |
| Shortest period | 10 s (so a local validator can run several periods) | 1 hour |
| IDL | identical (one accounts struct for both; the build script fails if they differ) | |

## Accounts

Sizes are explicit constants with a unit test that `INIT_SPACE` matches them (`tests.rs`). Every account starts with `version = 1` and ends with reserved bytes.

### `Config`: PDA `["config"]`, 800 bytes

| Field | Type | Notes |
|---|---|---|
| version | u8 | 1 |
| admin | Pubkey | Squads vault on mainnet (M10); the deployer on devnet |
| keeper_authority | Option<Pubkey> | `None` = anyone can execute |
| paused | bool | blocks `create_plan` and `execute_installment`; closing always works |
| allowed_funding_mints | [Pubkey; 4] | unused slots are the default key |
| max_slippage_bps | u16 | ceiling for every output (≤ 2,000) |
| max_oracle_staleness_s | u32 | 1 to 3,600 |
| catch_up_window_periods | u16 | 0 to 4 |
| protocol_fee_bps | u16 | 0 to 100; a non-zero fee needs `fee_recipient` |
| fee_recipient | Pubkey | owner of the fee token account |
| max_installment_amount | u64 | launch cap, raw funding units |
| bump | u8 | |
| max_confidence_bps | u16 | maximum `conf / price` (1 to 1,000) |
| treasury | Pubkey | owner of the token account that receives spent funding (devnet build) |
| allowed_freeze_authorities | [Pubkey; 4] | accepted freeze **and** Pausable authorities |
| allowed_permanent_delegates | [Pubkey; 4] | accepted permanent delegates **and** confidential-transfer authorities |
| allowed_transfer_hook_programs | [Pubkey; 4] | |
| reserved | [u8; 128] | |

### `Asset`: PDA `["asset", mint]`, 190 bytes

`version, mint, token_program, pyth_feed_id [u8;32] (underlying equity, price per share), decimals, enabled, bump, extensions u64 (bit n = Token-2022 ExtensionType n present at registration), scaled_ui_amount, mock_mint_bump, registered_at, reserved [u8;64]`.

### `Plan`: PDA `["plan", owner, funding_mint, nonce_le_u64]`, 1,079 bytes

All fixed-size fields come before `outputs`, so each has a fixed offset for `memcmp` filters (`owner` at 9, `funding_mint` at 41).

`version, owner, funding_mint, nonce, funding_amount, period_seconds, starts_at, expires_at (= starts_at + periods × period_seconds), created_at, periods, executed_periods, skipped_periods, last_executed_period (u16::MAX = none), last_executed_at, paused_by_owner, leg_bitmap u32, subscription_authority, recurring_delegation, subscription_init_id, bump, funding_token_program, catch_up_window_periods (snapshot at creation), in_progress_period (u16::MAX = none), staging_start_balance, outputs Vec<Output> (≤ 20), reserved [u8;96]`.

`Output { mint, weight_bps u16, max_slippage_bps u16 }`.

The plan's staging account is the plan PDA's associated token account for the funding mint, created by `create_plan`.

## Instructions

| Instruction | Signer | Checks |
|---|---|---|
| `initialize_config(params)` | the upgrade authority, read from the ProgramData account | once (`init`); every value in range |
| `update_config(params)` | `config.admin` | every value in range; can hand over `admin` and set `keeper_authority = None` |
| `set_paused(bool)` | `config.admin` | |
| `register_asset(pyth_feed_id)` | `config.admin` | once per mint; the Token-2022 policy below; devnet build: mint authority = mock PDA |
| `set_asset_enabled(bool)` | `config.admin` | |
| `create_plan(args)` | owner | not paused; funding mint allow-listed; 1 to 20 distinct outputs, none the funding mint, each a registered **enabled** asset (one `Asset` account per output in `remaining_accounts`); weights > 0 summing to 10,000 and every leg receiving funds; slippage ≤ the cap; amount ≤ the launch cap; period ≥ the minimum, schedule ≤ 366 days, start within [now − 120 s, now + 30 days]; the Subscriptions accounts (below); the owner's funding account delegates to the SubscriptionAuthority |
| `pause_plan`, `resume_plan` | owner | refuses a no-op |
| `execute_installment(period, leg_mask)` | keeper (anyone if `keeper_authority` is `None`) | see below |
| `close_plan` | owner | always (reads no config): returns staging, closes staging and the plan with all rent to the owner, emits `PlanClosed { plan, owner, … }`. The client adds the Subscriptions revoke to the same transaction |

### Subscriptions checks (`integrations/subscriptions.rs`)

Both accounts must be owned by the Subscriptions program, at their canonical PDAs, with the exact upstream length (authority 106, recurring delegation 211 bytes), discriminator (0, 3) and header version (1). The delegation must name the owner as delegator, the plan PDA as delegatee, the plan's mint and authority, the authority's current `init_id`, and these terms:

- `period_length_s = period_seconds`;
- `amount_per_period = funding_amount × (1 + catch_up_window_periods)`;
- `expiry = expires_at + catch_up_window_periods × period_seconds`;
- at creation: `current_period_start = starts_at` and nothing pulled.

The upstream program caps pulls per time period with no carry-over (`validate_recurring_transfer`), so a caught-up installment uses the next period's allowance; the allowance and expiry above make room for exactly the catch-up window. The program's own accounting still pulls exactly one installment per plan period.

Upstream also refuses delegations on mints with a permanent delegate, a transfer hook, pausable or confidential transfers. That applies to the **funding** mint only (USDC and the devnet test USD are classic SPL mints).

### `execute_installment`

1. Neither the config nor the plan is paused; the keeper matches when one is set; `leg_mask` is non-empty, within the plan's legs and disjoint from `leg_bitmap`; six remaining accounts per leg: `[asset, output_mint, owner_output_token, price_update, mock_mint_authority, output_token_program]`.
2. **First leg of a period** (`leg_bitmap == 0`): `index = (now − starts_at) / period_seconds`; the only period that may run is the **oldest runnable** one, `max(last + 1, index − window)`, and it must not be in the future or past the last period. It must equal `period`. Periods between the last executed one and it can never run and are added to `skipped_periods`. Running the oldest first means no executor can skip an in-window period on purpose. The delegation is re-verified, `funding_amount` is pulled through the Subscriptions CPI (plan PDA signs as delegatee) into staging, and the exact debit and credit are checked.
3. **Later legs**: `period` must equal `in_progress_period`.
4. **Each leg**: the asset is this program's PDA for the output mint, current and enabled; the live mint passes the Token-2022 policy again (an extension turned on later fails closed), its decimals match, it is not paused and its mint authority is the mock PDA; the destination is exactly the owner's associated token account; the price is a receiver-owned `PriceUpdateV2` (discriminator checked), **fully verified**, for the asset's feed, at most `max_oracle_staleness_s` old, with `conf / price ≤ max_confidence_bps`. Then:
   - `leg_funding` = cumulative-floor split of `funding_amount` by weight (the legs always sum to the installment, in any order);
   - `fee = floor(leg_funding × protocol_fee_bps / 10,000)` to the fee recipient; the rest is `amount_in`, moved to the treasury;
   - `expected_out = floor(amount_in × 10^(out_dec − fund_dec − expo + 12) / (price × multiplier_fp))`, where `multiplier_fp` is the ScaledUiAmount multiplier in effect now (Token-2022 rule: the new multiplier applies from its timestamp), converted from its IEEE-754 bits to 12-decimal fixed point with integer operations only and rounded **up**. Exactly `expected_out` is minted, so the output is never worth more than the oracle value of the funding;
   - the owner's balance must rise by at least `min_out = floor(expected_out × (10,000 − slippage) / 10,000)`.
5. When the bitmap is full, staging must be back at its starting balance; the period is marked executed. `InstallmentExecuted { plan, period, legs: [{ leg, mint, amount_in, fee, amount_out, min_out, oracle_price, oracle_expo, oracle_publish_time, multiplier_fp }], newly_skipped, period_complete }`.

A failed leg rolls back the whole transaction, pull included. A period split across transactions stays in flight until its last leg runs; closing the plan returns whatever is in staging.

## Token-2022 policy (`token_policy.rs`)

Run by `register_asset` and again at every execution.

| Extension | Rule |
|---|---|
| Freeze authority | only if in `allowed_freeze_authorities` |
| Permanent delegate | only if in `allowed_permanent_delegates` |
| Transfer hook | no program, or a program in `allowed_transfer_hook_programs` |
| Confidential transfer (mint) | only with auto-approve **off** and an authority in `allowed_permanent_delegates` |
| Pausable | authority in `allowed_freeze_authorities`; a paused mint is refused at execution |
| ScaledUiAmount | accepted; applied in the oracle math |
| Metadata pointer, token metadata, group pointers | accepted |
| Default account state | `Initialized` only |
| Non-transferable | rejected |
| Transfer fee, interest-bearing, mint close authority, confidential mint/burn, confidential fees, unknown types | rejected |

**Real xStocks** (read-only, mainnet slot 469,277,079; 40 catalog mints): every mint is Token-2022 with 8 decimals and the same extension set and authorities.

| Item | Value on all 40 |
|---|---|
| Freeze authority, Pausable authority | `JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs` (none paused) |
| Permanent delegate, confidential-transfer authority, transfer-hook authority, metadata update authority | `5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq` |
| Confidential transfer | auto-approve off, no auditor |
| Transfer hook program | none |
| Default account state | Initialized |
| ScaledUiAmount authority | `S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS` |
| ScaledUiAmount multiplier | 1 for AMD, AMZN, GLD, NOW, PLTR, TSLA (no dividends); above 1 for dividend payers, up to 1.0296 (CVX); 29 of 40 ≠ 1 |
| Mint authority | `7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj` |

So one token is `multiplier` shares (a cumulative dividend factor), which is why the program divides by it. With the two issuer keys on the allow-lists, all six xStocks in the test fixtures register (`tests/litesvm/policy.test.ts`); with empty lists, all are refused. Mainnet registration is M10.

## Oracle feeds on devnet

The sponsored Pyth push accounts for the equity feeds exist on devnet (10 of the 40 catalog feeds) and mainnet (17 of 40) but are **months stale**. A keeper therefore posts a fresh, fully verified `PriceUpdateV2` through the Pyth receiver before (or in the same transaction as) `execute_installment` (M7). That needs a Hermes API key, which is an owner step. Equity feeds update in US market hours, so a 60-second staleness bound means installments run in market hours; the catch-up window covers a weekend only for periods of a week or longer.

## Security properties

- No minting code in the mainnet build; minting only at the oracle value from a per-asset PDA.
- Exact Subscriptions debit and credit; staging restored; destination is the owner's ATA.
- No `init-if-needed`; every account is created once with `init`. All math is `checked_*` in u128, with `overflow-checks = true` in release. No floats: the multiplier is converted from its bit pattern.
- `token_interface` throughout (Token-2022 outputs).
- `security.txt` embedded. `#![deny(clippy::all)]`; the one crate-level allow (`result_large_err`) is for Anchor's error type.
- Open: verifiable build and published hash (M8), Squads multisig upgrade authority (M10), external audit (M10).

## Tests

| Layer | Where | What |
|---|---|---|
| Rust unit + proptest | `math_tests.rs`, `integrations/subscriptions.rs`, `tests.rs` | schedule, catch-up, skip, delegation terms, leg split, slippage floor, fees, decimals, scaled amount, multiplier conversion, staleness, confidence, layout parsing, sizes, argument validation; proptests: never more than `periods × amount` pulled and executed + skipped ≤ periods, legs sum exactly, output never above oracle value |
| LiteSVM | `packages/contracts/tests/litesvm` | 56 cases through the real v1 builders with the pinned Subscriptions and Pyth receiver binaries |
| Client | `packages/guard/src/v1/*.test.ts` | PDAs, mirrors, decoders, builders (100% lines) |
| Drift | `packages/guard/src/v1/drift.test.ts`, `idl:check` | committed IDL = Rust program; generated client = a fresh Codama render |
| Local end to end | `pnpm --filter @aroma/contracts e2e:local` | a real validator, a real deploy, three periods with a catch-up and a skip, close + revoke |
