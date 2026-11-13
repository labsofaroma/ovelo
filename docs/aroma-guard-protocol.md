# Aroma Guard Prototype (devnet, being retired)

Referenced by `packages/anchor/README.md`. This describes the **prototype** program currently deployed on devnet. It is being replaced by a ground-up rebuild, Aroma Guard v1, with a new program ID; see [CONTRACT-V1-SPEC.md](./CONTRACT-V1-SPEC.md). The `v2`/`plan_v2` names below are the prototype’s own internal labels.

- Program ID: `8Fm9HENPAFnyo6L8cHJFx62HHsZ6ez6CPUDuzgKAzrjs` (devnet)
- Source: `packages/anchor/programs/aroma_guard`
- IDL: `apps/web/lib/sdk/guard/aroma_guard.json` (kept in sync with `pnpm --filter @aroma/anchor idl:sync`)
- SDK builders: `apps/web/lib/sdk/guard/devnet.ts`
- External dependency: Solana Subscriptions program `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`

## Model

A **plan** is a recurring purchase owned by one wallet. The owner approves a bounded recurring grant through the official Subscriptions program. The delegate (the "buyer") is the plan PDA. Each period, anyone can trigger `execute_swap`. The plan PDA pulls exactly `funding_amount` of the funding token into a plan-owned staging account, mock stock is minted to the owner's token accounts, and the staged funding is burned.

The collector (keeper) **only pays transaction fees**. It never holds token authority.

## Accounts

### Plan: PDA `["plan_v2", owner, funding_mint, nonce_le_u64]`
| Field | Type | Meaning |
|---|---|---|
| version | u8 | `2` |
| devnet_mock | bool | stored, **not enforced** (see audit C-2) |
| owner, funding_mint | Pubkey | |
| nonce | u64 | lets one owner have many plans for one mint |
| funding_amount | u64 | raw units per installment |
| period_seconds | u64 | ≥ 60 |
| starts_at / expires_at | i64 | `expires_at = starts_at + periods × period_seconds`, which is at most one year |
| periods / executed_periods / last_executed_period | u16 | `last_executed_period = u16::MAX` before the first run |
| last_executed_at | i64 | |
| subscription_authority / recurring_delegation | Pubkey | canonical Subscriptions PDAs |
| subscription_init_id | i64 | binds the plan to one delegation generation |
| bump | u8 | |
| outputs | Vec<Output> (≤ 20) | `{ mint, weight_bps, minimum_amount_out }`, with weights summing to 10,000 |

Space: `8 + 197 + 20 × 42` bytes.

### Mock mint authority: PDA `["mock_mint_authority"]`
A global mint authority for all devnet test-stock mints.

## Instructions

### `create_plan(data: CreatePlanData)` (signer: owner)
Checks:
- `period_seconds ≥ 60`, `starts_at` in the future and within 300 s of now, duration ≤ 1 year, and `expires_at` exactly aligned.
- 1–20 outputs, distinct mints, none equal to the funding mint, each `weight_bps > 0` and `minimum_amount_out > 0`, weights summing to 10,000.
- The funding mint has no freeze authority.
- The staging account is owned by the plan PDA, has the right mint, is not frozen, and has no delegate or close authority.
- The Subscriptions authority and delegation are the canonical PDAs owned by the official program, and the delegation terms (amount, period, start, expiry, `pulled == 0`) match the plan.

### `execute_swap(expected_period: u16)` (signer: any fee payer)
`remaining_accounts` = for each output: `[output_mint (mut), owner_output_token (mut)]`.
1. Work out the due period: `index = (now - starts_at) / period_seconds`. It must be greater than `last_executed_period` and equal `expected_period`. **Earlier missed periods are not executed later.**
2. Recheck the delegation against the stored terms and the current init id.
3. Run the Subscriptions `transfer` CPI (discriminator `5`) signed by the plan PDA, moving `funding_amount` from the owner to staging. Verify the exact debit and credit.
4. For each output, mint `minimum_amount_out` from the mock authority to the owner's account, then verify the owner, the mint and the exact balance change.
5. Burn the staged funding and verify staging returns to its previous balance.
6. Update the counters and emit `InstallmentExecuted`.

### `close_plan()` (signer: owner)
Returns any staging balance to the owner, closes staging (rent to the owner) and closes the plan (rent to `rent_payer`). It does **not** revoke the Subscriptions grant. Revoke it separately through `/api/recurring/revoke`.

## Events
`PlanCreated { plan, owner, nonce, starts_at, expires_at }` · `InstallmentExecuted { plan, period, funding_amount, output_amounts, timestamp }` · `PlanClosed { plan, timestamp }`

## Known limitations
See [AUDIT.md §1](./AUDIT.md#1-smart-contract--packagesanchorprogramsaroma_guard). In short: output amounts are chosen by the creator and no price backs them, any funding mint is accepted, missed periods are skipped, there is no swap path, and there are no admin controls. **Do not deploy this program to mainnet.**

## Deployment requirements
1. `anchor build` (with the toolchain from `Anchor.toml`) → `anchor deploy --provider.cluster devnet`. The upgrade authority should be a multisig.
2. `pnpm --filter @aroma/anchor idl:sync`.
3. Provision the test-stock mints with the mock PDA as mint authority and **no** freeze authority. Record them in `apps/web/public/xstocks-devnet/xstocks.json`.
4. Changing source or building locally does **not** upgrade devnet. Preparation simulates against the deployed binary.
