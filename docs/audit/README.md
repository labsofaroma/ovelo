# Aroma Guard v1: audit package

_Prepared in M8 (14 November 2026) for the external audit booked for M10 (REWRITE-PLAN §7.1, P2)._

Aroma Guard v1 is a standalone Solana program for recurring investing. An owner approves a bounded recurring grant of a stablecoin (the Solana Foundation **Subscriptions** program). Each period the program pulls one installment into a plan-owned staging account, swaps each leg's share through **Jupiter** into tokenized stocks (**xStocks**, Token-2022), and accepts the swap only if the owner's own token account received at least an **oracle-bounded** minimum (**Pyth**).

| Document | Contents |
|---|---|
| this file | scope, commit, build and hash, how to run every test |
| [threat-model.md](./threat-model.md) | actors, trust boundaries, assets, attacks considered and the control for each |
| [invariants.md](./invariants.md) | the properties the program must keep, and where each is enforced and tested |
| [decisions.md](./decisions.md) | M8 decisions 1–3 with evidence, and the design decisions an auditor should challenge |
| [limitations.md](./limitations.md) | known limitations, what is not tested, and what is out of scope |

## Scope

**In scope: the on-chain program**, `packages/contracts/programs/aroma_guard/src/` (3,646 lines of Rust including unit tests), at program-source commit **`85351503f81f87056c0bccab8ed48c7abe7b65dd`** on branch `m8-mainnet-path`. The program sources have not changed in any later M8 commit (`git log -- packages/contracts/programs` shows that commit last). The owner will name the final audit commit when the branch is merged (P6).

| Path | What it is | Priority |
|---|---|---|
| `instructions/execute/route.rs` | one mainnet leg: account prefix, forbidden accounts, Token-2022 policy, oracle floor, Jupiter CPI, balance verification | **highest** |
| `instructions/execute/mainnet.rs` | `execute_installment_routed` handler (keeper-only), remaining-account layout; `execute_installment` fails closed | **highest** |
| `instructions/execute/common.rs` | period start (oldest runnable period, skips, Subscriptions pull with exact debit and credit) and finish (staging restored) | **highest** |
| `integrations/jupiter.rs` | pinned `route_v2` wire format, terms check, CPI instruction (signer flags) | **highest** |
| `swap_math.rs` | leg terms (fee, `amount_in`, `expected_out`, `min_out`) and `verify_swap` | **highest** |
| `math.rs` | schedule, catch-up and skip, delegation terms, leg split, decimals, ScaledUiAmount bit-pattern conversion | high |
| `integrations/subscriptions.rs` | typed layout of the Subscriptions accounts (pinned upstream `program-v0.5.0`), delegation checks, pull instruction | high |
| `integrations/pyth.rs` | `PriceUpdateV2` reads: owner, discriminator, full verification, feed, staleness, confidence | high |
| `token_policy.rs` | Token-2022 extension policy at registration and at every execution | high |
| `instructions/plan/*`, `instructions/admin/*`, `state/*` | plan lifecycle, config and asset registry (M6) | medium |
| `instructions/execute/devnet_mock.rs` | the devnet build only (`--features devnet-mock`); never in the mainnet binary (`check-build.mjs`) | low (not deployed to mainnet) |

**Out of scope** (context only): the TypeScript client `packages/guard` (builders mirror the program's checks, but the program never relies on them), the keeper `apps/keeper`, the web app, and the upstream programs (Jupiter v6, the AMMs it routes through, Subscriptions, Pyth receiver, Wormhole, SPL Token, Token-2022). Upstream binaries are pinned by SHA-256 for testing (`tests/fixtures/runtime-programs.json`, `tests/fixtures/mainnet-programs.json`).

## Program and toolchain

| | |
|---|---|
| Program ID | `FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU` (owner's keypair; not deployed to mainnet) |
| Framework | Anchor 1.2.1 (`anchor-lang`, `anchor-spl` pinned `=1.2.1`), `pyth-solana-receiver-sdk` 2.0.0 |
| Toolchain | Agave 3.1.10 (`cargo-build-sbf`), rustc 1.96.1, **SBPF v0** (`--arch v0`; v3 deployment is inactive on mainnet) |
| Release profile | `overflow-checks = true`, fat LTO, `codegen-units = 1` |
| Builds | default (mainnet: Jupiter path, no minting code) and `--features devnet-mock` (mints at the oracle price); one IDL for both |

## Build and hash

```bash
cd packages/contracts
bash scripts/build.sh            # both builds, SBPF v0; check-build.mjs proves the minting
                                 # marker and mock_mint seed are absent from the default binary
                                 # and the Jupiter CPI path is absent from the devnet one
bash scripts/verify-build.sh     # rebuild + compare with verifiable-build.json "local"
```

| Default (mainnet) build | |
|---|---|
| `solana-verify get-executable-hash` | **`58f20550182f0c9002526a05269ae9971222f2b1e91d2032b39c593b529fb1f8`** |
| file SHA-256 | `f97f32ca8a575da3cebd7b448add5506ced4889d332dfbc7e9c1e29e5874d914` (497,648 bytes) |
| reproducibility | byte-identical after a forced recompile on the build machine (macOS arm64) |

This local hash depends on the machine (release binaries can embed paths). The hash to **publish** comes from the pinned Docker image, which is an owner step because the image was not pulled in M8:

```bash
docker pull solanafoundation/solana-verifiable-build:3.1.10   # record the image digest
cd packages/contracts && bash scripts/verify-build.sh --docker  # = solana-verify build --library-name aroma_guard --arch v0 --base-image <image> .
```

Record the result as `docker` in `packages/contracts/verifiable-build.json`. CI's `verifiable-build` job runs the same command; CI is not verified yet.

## How to run the tests

Prerequisites: Node 24.12, pnpm 10.31, Agave 3.1.10 and anchor-cli 1.2.1 on `PATH`, `pnpm install`.

```bash
cd packages/contracts
pnpm build                                   # both builds (needed by LiteSVM and the fork)
pnpm test:native                             # cargo test, both feature sets (unit + proptest)
pnpm test:clippy                             # clippy -D warnings, both feature sets
pnpm test:fixtures && pnpm test:fixtures:mainnet   # pinned upstream binaries (read-only, SHA-256 checked)
pnpm test:litesvm                            # LiteSVM: devnet-mock and default builds
pnpm test:litesvm:subscriptions-mainnet      # the same suite against mainnet's Subscriptions binary
pnpm idl:check                               # IDL and Codama client = Rust program
pnpm e2e:fork                                # mainnet fork, 3 one-hour periods (~2.5 h); E2E_FORK_PERIODS=1 for ~3 min
cargo llvm-cov -p aroma_guard --summary-only # host coverage (cargo-llvm-cov)
```

| Layer | Count (M8) | Where |
|---|---|---|
| Rust unit + proptest | 38 (default build), 25 (devnet-mock); each proptest 2,000 cases | `math_tests.rs`, `swap_math_tests.rs`, `integrations/*.rs`, `tests.rs`, `execute/mainnet.rs` |
| LiteSVM | 85 cases: 62 (M6/M7, devnet-mock), 6 mainnet happy paths, 12 mainnet refusals, 4 Subscriptions semantics, 1 devnet routed refusal | `tests/litesvm/**` |
| Mainnet fork | create → 3 periods (3 execute transactions each) → close + revoke | `scripts/e2e-fork.ts` |

The mainnet LiteSVM cases use the **real** Jupiter v6, Orca Whirlpool, Token and Token-2022 binaries from mainnet, plus real Whirlpool pools and xStocks mints. These were recorded read-only at mainnet slot 469,359,673 (`scripts/record-jupiter-mainnet.ts`). Adversarial routes are tampered with *after* the client builder, so each refusal is the program's own.

A recording is valid until an upstream program redeploys. `pnpm test:fixtures:mainnet` then fails on the SHA-256 until the routes are re-recorded (`pnpm fixtures:jupiter`) and reviewed.
