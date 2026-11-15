# Ovelo Guard v1 — Contract Specification

_Status: specification, 13 November 2026. M6 implements the core and the devnet build, M8 the mainnet (Jupiter) path ([ovelo-guard-v1.md](./ovelo-guard-v1.md), audit package [audit/](./audit/README.md)); deviations and decisions are in REWRITE-PLAN, M6 and M8 status._

Ovelo Guard v1 is a standalone program with its own program ID, account layout and instructions. The implementation lives in `packages/contracts` and is described in [ovelo-guard-v1.md](./ovelo-guard-v1.md).

---

## 1. Goals

1. **Integrity:** no plan can create value from nothing, on devnet or mainnet.
2. **Real execution:** each installment swaps real funding (USDC) into real tokenized stocks (xStocks), with slippage bounded by an oracle.
3. **Non-custodial:** the owner keeps custody. The program and keeper move only the approved installment, and only to the owner.
4. **Built to evolve:** versioned accounts with reserved space, a config account, a pause switch and a multisig upgrade authority from day one.
5. **Honest scheduling:** a missed installment can be caught up within a grace window, or is explicitly marked as skipped.

## 2. One codebase, two builds

| | devnet build | mainnet build |
|---|---|---|
| Cargo feature | `devnet-mock` | default |
| Output delivery | mint test stock **at the oracle price** from a per-asset mint authority | Jupiter CPI swap, then verify delivery |
| Funding mint | config allow-list (test USD) | config allow-list (USDC, optionally PYUSD) |

Whether minting exists is decided at compile time (`#[cfg(feature = "devnet-mock")]`). The mainnet binary contains no minting code.

## 3. Program layout

```
packages/contracts/programs/ovelo_guard/src/
  lib.rs                 entrypoints only
  constants.rs           seeds, limits
  errors.rs
  events.rs
  state/                 config.rs, asset.rs, plan.rs
  instructions/
    admin/               initialize_config, update_config, set_paused, register_asset, set_asset_enabled
    plan/                create_plan, pause_plan, resume_plan, close_plan
    execute/             execute_installment (mainnet.rs | devnet_mock.rs)
  integrations/
    subscriptions.rs     typed layout + discriminator checks for the Subscriptions program
    pyth.rs              price reads, staleness and confidence checks
    jupiter.rs           CPI wrapper
  math.rs                schedule and slippage math (pure, unit-tested)
```

## 4. Accounts

### `Config`: PDA `["config"]`, one per program
```rust
pub struct Config {
    pub version: u8,                      // 1
    pub admin: Pubkey,                    // Squads multisig vault
    pub keeper_authority: Option<Pubkey>, // None = anyone can execute
    pub paused: bool,
    pub allowed_funding_mints: [Pubkey; 4],
    pub max_slippage_bps: u16,            // global ceiling, e.g. 300
    pub max_oracle_staleness_s: u32,      // e.g. 60
    pub catch_up_window_periods: u16,
    pub protocol_fee_bps: u16,            // 0 at launch
    pub fee_recipient: Pubkey,
    pub max_installment_amount: u64,      // launch cap
    pub bump: u8,
    pub reserved: [u8; 128],
}
```

### `Asset`: PDA `["asset", mint]`
```rust
pub struct Asset {
    pub mint: Pubkey,
    pub token_program: Pubkey,  // SPL Token or Token-2022
    pub pyth_feed_id: [u8; 32], // Pyth feed for the underlying equity
    pub decimals: u8,
    pub enabled: bool,
    pub bump: u8,
    pub reserved: [u8; 64],
}
```
Only registered and enabled assets can be plan outputs.

### `Plan`: PDA `["plan", owner, funding_mint, nonce_le_u64]`
```rust
pub struct Plan {
    pub version: u8,              // 1
    pub owner: Pubkey,
    pub funding_mint: Pubkey,
    pub nonce: u64,
    pub funding_amount: u64,      // per installment, raw units
    pub period_seconds: u64,
    pub starts_at: i64,
    pub expires_at: i64,
    pub created_at: i64,
    pub periods: u16,
    pub executed_periods: u16,
    pub skipped_periods: u16,
    pub last_executed_period: u16, // u16::MAX = none yet
    pub last_executed_at: i64,
    pub paused_by_owner: bool,
    pub leg_bitmap: u32,          // legs done in the current period (multi-transaction execution)
    pub subscription_authority: Pubkey,
    pub recurring_delegation: Pubkey,
    pub subscription_init_id: i64,
    pub bump: u8,
    pub outputs: Vec<Output>,     // ≤ 20
    pub reserved: [u8; 96],
}
pub struct Output { pub mint: Pubkey, pub weight_bps: u16, pub max_slippage_bps: u16 }
```
The helpers in `lib/sdk` enforce a limit on outputs per transaction that accounts for transaction size (about 5 with Jupiter routes). Larger baskets run one transaction per leg.

## 5. Instructions

| Instruction | Signer | Behaviour |
|---|---|---|
| `initialize_config` | upgrade authority (once) | sets the admin to the multisig |
| `update_config`, `set_paused` | `Config.admin` | pause blocks `create_plan` and `execute_installment`. **Closing a plan always works.** |
| `register_asset`, `set_asset_enabled` | `Config.admin` | rejects mints that have a permanent delegate, a transfer hook not on the allow-list, or a freeze authority not on the allow-list |
| `create_plan` | owner | funding mint must be on the allow-list, outputs must be registered assets, weights must sum to 10,000, slippage at or below the cap, amount at or below the launch cap. Checks the Subscriptions delegation by **discriminator**, PDA and terms |
| `pause_plan`, `resume_plan` | owner | |
| `execute_installment(period, leg_mask)` | keeper (or anyone, if `keeper_authority` is None) | see §6 (devnet build) |
| `execute_installment_routed(period, leg_mask, routes)` | keeper (required in the mainnet build, M8 decision 1) | see §6 (mainnet build): each leg's Jupiter `route_v2` instruction data and its accounts |
| `close_plan` | owner | returns staging funds, closes accounts, sends **rent to the owner**, emits `PlanClosed { plan, owner }`. The client code puts the Subscriptions **revoke** in the same transaction |

## 6. `execute_installment`

1. Require that neither the config nor the plan is paused.
2. **Schedule:** `index = (now - starts_at) / period_seconds`. A period can run if `index > last_executed_period` and `period >= index - catch_up_window_periods`. Periods older than the window are added to `skipped_periods`.
3. **Collect:** on the first leg of a period, pull `funding_amount` through the Subscriptions CPI into a plan-owned staging account. Verify the exact debit and credit.
4. **For each leg in `leg_mask`:**
   - Read the Pyth price for `asset.pyth_feed_id`. Require `publish_time` within `max_oracle_staleness_s` and a confidence interval below the threshold.
   - `expected_out = leg_funding / price` (adjusted for decimals). `min_out = expected_out × (10,000 − max_slippage_bps) / 10,000`.
   - **Mainnet:** CPI into Jupiter, with route accounts from `remaining_accounts` and the plan PDA signing as source authority. The **destination must be the owner's ATA** for `asset.mint`.
   - **Devnet (`devnet-mock`):** mint `expected_out` from PDA `["mock_mint", mint]`, and move the leg's funding to a treasury (not burn it).
   - Verify the owner's ATA increased by at least `min_out`.
5. When all legs are done (`leg_bitmap` is full), staging must be back at its starting balance. Mark the period executed and clear the bitmap.
6. Emit `InstallmentExecuted { plan, period, legs: [(mint, amount_in, amount_out, oracle_price)] }`.

The keeper builds Jupiter routes off-chain. The program does not trust the route; it trusts only the oracle floor and the owner's balance change.

## 7. Security requirements (from day one)

- [x] (M6) Typed Subscriptions layout with discriminator and length checks, in `integrations/subscriptions.rs` with the upstream version pinned.
- [x] (M6) No `init-if-needed`.
- [x] (M6) `checked_*` math everywhere, and `overflow-checks = true`.
- [x] (M6) `token_interface` / `InterfaceAccount`, so Token-2022 xStocks work. List each mint's extensions in the asset registry.
- [x] (M6) `solana-security-txt` embedded in the program.
- [ ] Verifiable builds (`solana-verify`), with the hash published. (M8: `scripts/verify-build.sh`, local hash recorded in `packages/contracts/verifiable-build.json`; the Docker hash and its publication are owner steps.)
- [ ] Upgrade authority on a Squads multisig (at least 2-of-3), with a timelock on mainnet.
- [ ] External audit (OtterSec, Neodyme, Sec3, Zellic or similar) before mainnet.

## 8. Tests

| Layer | Tool | Cases |
|---|---|---|
| Pure math | `cargo test` | schedule, catch-up, skip, slippage, decimals, oracle staleness |
| Program | LiteSVM with pinned Subscriptions, Pyth receiver and Jupiter binaries | 1-leg and N-leg happy paths; slippage failure on a later leg → full rollback; stale oracle; wrong destination owner; unregistered mint; config paused; owner paused; close while paused; replay; catch-up window; leg bitmap across transactions |
| Property / fuzz | `proptest` or Trident | no schedule ever pulls more than `periods × funding_amount` |
| Helpers (`lib/sdk`) | `node --test` | instruction builders, decoders, IDL sync |
| Devnet end-to-end | scripted | create → three periods → close + revoke |

## 9. Delivery

> **Milestones** ([REWRITE-PLAN.md §7](./REWRITE-PLAN.md#7-build-order-and-exit-criteria)): items 1 and the devnet-mock half of the test plan are **M6**; item 2 (Jupiter CPI, full LiteSVM with pinned binaries, fuzz) is **M8**; item 3 is M6 (builders) and **M7** (keeper, web app); item 4 and the mainnet beta (item 5) are **M12**, after launch, once the mainnet deploy (about 5 SOL peak, about 2.5 SOL refundable rent) is funded. Deploys, the auditor and the multisig are owner steps.

1. **Weeks 1–2:** config, asset registry, plan, admin and plan instructions, devnet-mock execution at the oracle price. Deploy to devnet under its own program ID.
2. **Weeks 3–4:** Jupiter CPI path and the full LiteSVM suite.
3. **Week 5:** v1 builders in `lib/sdk` and the keeper, wired into the rebuilt web app.
4. **Weeks 6–8:** external audit, fixes, verifiable build, multisig handover.
5. **Mainnet beta:** launch caps in `Config` (for example $500 per installment, $50k total). Monitor, then raise the caps.

## 10. Deploying with your own account

v1 has its own **program ID, generated fresh and owned by your wallet**. The step-by-step runbook for devnet is [M6-DEVNET-DEPLOY.md](./M6-DEVNET-DEPLOY.md).

```bash
# 1. Your deployer wallet (keep it offline/backed up; it pays for and controls the deploy)
solana-keygen new -o ~/.config/solana/ovelo-deployer.json
solana config set --keypair ~/.config/solana/ovelo-deployer.json --url devnet
solana airdrop 5   # devnet; a v1 program needs roughly 3–6 SOL of rent

# 2. A fresh program keypair → this becomes the v1 program ID
solana-keygen new -o target/deploy/ovelo_guard-keypair.json
anchor keys sync   # writes the new ID into declare_id! and Anchor.toml

# 3. Build and deploy
anchor build
anchor deploy --provider.cluster devnet --provider.wallet ~/.config/solana/ovelo-deployer.json

# 4. Confirm you are the upgrade authority
solana program show <PROGRAM_ID>
```

After deploying:
- Run `initialize_config` from the deployer wallet, then `register_asset` for each test stock.
- Update the program ID in the v1 IDL and generated client (`pnpm --filter @ovelo/contracts idl:sync`) and the v1 devnet deployment record (`packages/guard/src/v1/deployments.ts`).
- **Never commit** `ovelo-deployer.json` or `ovelo_guard-keypair.json`; `target/` is already git-ignored.
- Before mainnet, hand the upgrade authority to a Squads multisig: `solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_VAULT>`. Keep your wallet as one of the signers.
- For mainnet, use a separate deployer wallet from devnet, funded only for the deploy.

## 11. Decisions needed (owner: product)

1. **Keeper:** anyone can execute (with a small tip), or only Ovelo's keeper?
2. **Protocol fee:** 0 bps at launch, or a small fee per installment?
3. **Catch-up window:** how many missed periods can run late? (Proposed: 1.)
4. **Funding tokens:** USDC only, or also PYUSD and USDT?
5. **Token-2022:** which xStock extensions are acceptable?
