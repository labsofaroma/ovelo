# Decisions (M8) and evidence

## 1. Executor price choice: keeper-only on mainnet, plus a 20-second price-age cap

**Problem** (M8 plan note 1). With `keeper_authority = None`, any executor may pass any fully verified `PriceUpdateV2` within `max_oracle_staleness_s` (up to 3,600 s by config; 60 s by default). On the Jupiter path the oracle sets the floor, not the amount delivered. So an executor who picks the highest price in the window lowers `expected_out` and loosens `min_out`. They can then route the swap through a pool they have skewed, or sandwich it, and capture the difference down to the floor. Permissionless execution also lets a third party choose the *timing* (thin liquidity, around their own trades) and the route, again bounded only by the floor.

**Options weighed**

| Option | MEV / griefing | Liveness and trust | Change |
|---|---|---|---|
| a. keeper-only | removes third-party price, timing and route choice | depends on Aroma's keeper (alerts, catch-up window, admin can rotate the key) | none in the IDL |
| b. tighter window only | limits price choice to the window, but anyone still chooses timing and route | permissionless | none in the IDL |
| c. a + b (**chosen**) | third parties excluded; even a compromised keeper key can only choose among updates from the last 20 s | as (a) | none in the IDL |
| d. price posted in the same transaction | strongest | infeasible: a post (~580 B) plus a routed execute exceed one transaction (M7 measurement; a routed leg alone needs lookup tables) | — |

**Implementation** (mainnet build only; no IDL, layout or config change):
- `common::entry_checks(…, keeper_required = true)` returns `KeeperRequired` when `config.keeper_authority` is `None`, and `NotKeeper` for any other signer. The keeper also refuses to run against such a config (`assertMainnetKeeper`).
- `swap_math::effective_max_price_age = min(config.max_oracle_staleness_s, MAINNET_MAX_PRICE_AGE_S = 20)`. The admin can make it tighter through config but cannot make it looser.

**Trade-offs accepted:**
- Liveness rests on one keeper. The catch-up window (1 period) and alerts cover outages, and the admin multisig can rotate the key.
- Within 20 s the keeper still chooses which update to use. Equity prices move far less than the slippage cap in 20 s, and the keeper is the trusted operator.
- The keeper's own transaction can still be sandwiched down to the floor. That is bounded by each output's `max_slippage_bps` (≤ 300 by config), and reduced by priority fees and the optional Jito path.
- 20 s requires the keeper to post and execute promptly. It does so on the fork: a Hermes update at most 10 s old, then posts and execute in sequence.

**Tests:** LiteSVM `decision 1: a price older than 20 s is refused even though the config allows 60 s; 20 s is accepted` and `decision 1: keeper-only…`.

## 2. Subscriptions on mainnet: same layout and semantics, no mismatch

| | mainnet | devnet pin (tests) |
|---|---|---|
| ProgramData | `HaYb5J9eXooZuNzN3z6TfuzVDcaTfiDdDPWCFtexFfMg` | same address |
| last deploy slot | 438,440,823 (block time 1786381507 = 2026-08-10) | 506,642,674 |
| binary SHA-256 | `af3cefa5947173e03298361b3f461e2a314382a7206c084f77ad9a40c8b18d3a` (read at slot 469,358,055; = the M6 record) | `2675ad1d2b5068d47fc5d169156cf4859a9c21c0406ce63e3828e3b7320fddbf` |

The binaries differ, so behaviour was checked rather than assumed:

1. **The whole LiteSVM suite (62 cases at the time) passes against mainnet's binary** (`pnpm test:litesvm:subscriptions-mainnet`; the harness verifies `mainnetSha256`). It exercises the typed parsers (exact lengths 106 and 211, discriminators 0 and 3, header version 1), delegation creation, the pull, the catch-up that draws on the next period's allowance, revoke and close.
2. **Four direct cases on the upstream rules Aroma relies on, run on both binaries with exact upstream error codes** (`tests/litesvm/subscriptions-semantics.test.ts`):
   - at most `amount_per_period` per period (`AmountExceedsPeriodLimit` 400);
   - no carry-over from an unused period;
   - nothing after the expiry (`DelegationExpired` 128);
   - only the delegatee can pull (`Unauthorized` 130);
   - a stale `init_id` is refused (`StaleSubscriptionAuthority` 136);
   - the same-slot `UNKNOWN_INIT_ID` sentinel is accepted. The client's 1-step create flow needs this sentinel.
3. **Upstream source diff `program-v0.4.0…program-v0.5.0`** (GitHub compare): in `state/` and the transfer helpers only comments changed, plus `SubscriptionAuthority::check_init_id` with the sentinel (commit `55a3efd1`, 2026-07-15). Mainnet's deploy (2026-08-10) is after that commit and accepts the sentinel in test 2. M6's "≈ v0.4.0" label was a guess from the slot; behaviourally the mainnet binary matches the `program-v0.5.0` era.

**Conclusion:** nothing the program relies on differs, so there was no reason to stop. Re-run `pnpm test:fixtures:mainnet && pnpm test:litesvm:subscriptions-mainnet` before the mainnet deploy (M10). The fetch fails if upstream redeploys.

## 3. Rust coverage (cargo-llvm-cov, approved by the owner)

Host build, `cargo llvm-cov -p aroma_guard --summary-only`:

| Build | Lines | Regions |
|---|---|---|
| default | 42.90 % | 42.62 % |
| devnet-mock | 38.11 % | 37.76 % |

The pure modules are well covered: `integrations/jupiter.rs` 100 % lines, `swap_math.rs` 100 %, `math.rs` 95 %, `state/config.rs` 94 %, `integrations/subscriptions.rs` 78 %. The handlers (`route.rs`, `common.rs`, `mainnet.rs`, `token_policy.rs`, `pyth.rs`, plan and admin instructions) run only inside the SBF VM, so llvm-cov cannot see them. LiteSVM covers them instead: 85 cases, every handler path listed in the threat model. Instrumenting SBF coverage is not available with this toolchain.

## Design decisions to challenge

4. **A program-wide swap authority signs Jupiter, not the plan PDA.** The plan PDA is the Subscriptions delegatee, so lending its signature to AMM code would widen what a route could reach. Also, Jupiter's `route_v2` with `destinationTokenAccount` needs a transit account owned by the signer: per plan, that is one ATA per output mint whose rent is locked forever once the plan closes. Shared ATAs (one per mint) avoid both. Each leg must leave them at their starting balance.
5. **A new instruction, `execute_installment_routed(period, leg_mask, routes)`**, rather than new arguments on `execute_installment`. Jupiter's instruction data has to reach the program as an argument, and `execute_installment(period, leg_mask)` is the ABI being deployed to devnet. The IDL change is additive: one instruction, the `RouteLeg` type, seven appended error codes. Every existing code, instruction, account and type is unchanged. The same `ExecuteInstallment` accounts struct serves both instructions and both builds, so the IDLs stay identical.
6. **The oracle floor is on the leg's full funding** (spec §6), so a protocol fee comes out of the slippage budget. The devnet-mock build still computes its mint amount on `amount_in`, as it did in M6, and is not changed in M8.
7. **Only Jupiter `route_v2`, and only direct routes** (every step swaps the funding mint for the output mint; splits across pools are fine). A hop through another mint would need a third swap-authority account, which the program refuses. The keeper asks Jupiter for direct routes and refuses any other before signing.
8. **Two routed legs per transaction at most** (keeper), falling back to one leg per transaction when the measured size exceeds 1,232 bytes. Three Whirlpool legs need 57 unique accounts. Sizes depend on routes and lookup tables; on the fork each leg ran as its own transaction.
