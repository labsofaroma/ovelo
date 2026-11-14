# Known limitations and what is not tested

## Program

- **Issuer powers.** xStocks have a freeze authority, Pausable, a permanent delegate and the confidential-transfer extension. These are accepted only for the issuer keys on the config allow-lists (owner decision, M6). The issuer can freeze the owner's ATA or the swap authority's transit account, pause the mint, or move tokens with its permanent delegate. A paused mint, or a newly set transfer hook outside the allow-list, fails closed at execution.
- **Floor quality depends on Pyth.** The floor is the oracle value minus slippage. If the oracle itself is wrong within its confidence bound (`max_confidence_bps`, 200 bps in tests), so is the floor.
- **Market hours.** Equity feeds update in US market hours. With a 20-second age cap, installments run only then, and the catch-up window (1 period) covers a weekend only for weekly or longer periods. Skipped periods are recorded and alerted.
- **Keeper liveness.** Mainnet execution is keeper-only (decision 1). If the keeper is down past the window, periods are skipped. They are never pulled late outside the window.
- **Shared swap-authority accounts serialize execution** per output mint: two legs of the same mint in different plans cannot land in the same block.
- **`treasury_token` is required but unused** by the routed instruction, because one accounts struct serves both builds. The keeper passes the treasury's existing USDC ATA.
- **No in-plan fee snapshot.** `protocol_fee_bps` is read from config at execution (≤ 100 bps). A fee change cannot lower the floor (I9), but it can change how much of the slippage budget is left for the swap.
- **Duplicated pull code.** `execute/common.rs::collect` mirrors `devnet_mock::collect`. It was deliberately left as a copy while the devnet deploy runs in parallel, and becomes one function after the M7 rebase.

## Integrations

- **Jupiter.** Only `route_v2` is forwarded. A Jupiter upgrade that changes the `route_v2` layout before the route vector would make every route fail closed (`UnsupportedRoute` or `RouteTermsMismatch`) until reviewed. The mainnet binaries are pinned for tests, and `test:fixtures:mainnet` fails on any redeploy.
- **Routes the program cannot execute.** Hops through an intermediate mint are refused (decision 7), so some routes Jupiter would choose are unavailable and the keeper asks for direct routes only. For the 40 catalog xStocks this relies on direct USDC pools existing.
- **Transaction size.** One routed leg needs address lookup tables. The keeper uses Jupiter's tables, verifies them on chain, and falls back to one leg per transaction.

## Testing gaps

- **No real mainnet transaction** has been sent by any session. Everything ran on LiteSVM (real mainnet binaries and recorded pools) or a local mainnet fork. Real-money tests are an owner step (P5).
- **Prices on the fork and in LiteSVM** are not Hermes data. Hermes requires the owner's API key (401 without one). The fork's stand-in signs updates with a runtime test guardian installed in Wormhole's guardian set, at the market price implied by the recorded Jupiter quote plus 0.3 %. LiteSVM writes receiver-owned `PriceUpdateV2` accounts directly (as in M6). Real guardian-signed updates were exercised on devnet in M7 only through the receiver binary with a test guardian.
- **Fork routes are Orca Whirlpool only** (recording filter), because proprietary AMMs reject a stale fork. Production routes may use other DEXes; the program's checks do not depend on the DEX.
- **Rust coverage is host-only** (decision 3). Handler coverage comes from LiteSVM.
- **No Trident fuzzing** (owner decision: proptest only).
- **The Docker-verifiable hash is not produced** (the image was not pulled). The local hash is recorded and reproducible on the build machine.
- **CI not verified.** The workflow files are authored, not run on GitHub (P6).
