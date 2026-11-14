# M6 devnet deploy runbook: Aroma Guard v1

_For the owner. Agents never run these steps: they never create, read or use the deployer wallet and never send a devnet or mainnet transaction. Everything below targets **devnet only**; every script refuses any other genesis hash._

| | |
|---|---|
| Program ID | `FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU` |
| Program keypair | `packages/contracts/target/deploy/aroma_guard-keypair.json` (git-ignored; generated in M6) |
| Devnet keeper (devnet only) | `7qMWtAzRCnKR63GawKbGME4NdfLHHHoCtzWCdYXoio2j`, key in `packages/contracts/.keys/devnet-keeper.json` (git-ignored) |
| Binary deployed | `target/build/devnet-mock/aroma_guard.so` (SBPF v0, 479,312 bytes at M6) |
| Cost | ≈ 2.44 SOL of ProgramData rent, plus a same-size buffer during the deploy (refunded when it completes), plus fees and the test accounts: **fund 6 devnet SOL** |
| Toolchain | Agave 3.1.10, anchor-cli 1.2.1, Node 24, pnpm 10.31 (as pinned in `packages/contracts/Anchor.toml`) |

Run everything from the repository root on the `m6-contract-core` branch after `pnpm install`.

## 1. Back up the program keypair

It defines the program ID. Lose it before deploying and the ID changes; lose it after and you can still upgrade with the deployer (the upgrade authority), but you cannot redeploy at the same address after closing it.

```bash
solana-keygen pubkey packages/contracts/target/deploy/aroma_guard-keypair.json
# must print FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU
```
Copy the file to offline storage (password manager or encrypted drive). Never commit it.

## 2. Create and fund the deployer wallet (CONTRACT-V1-SPEC §10)

```bash
solana-keygen new -o ~/.config/solana/aroma-deployer.json   # write down the seed phrase offline
solana-keygen pubkey ~/.config/solana/aroma-deployer.json
solana airdrop 2 "$(solana-keygen pubkey ~/.config/solana/aroma-deployer.json)" --url devnet   # repeat, or use https://faucet.solana.com, until ≥ 6 SOL
solana balance "$(solana-keygen pubkey ~/.config/solana/aroma-deployer.json)" --url devnet
```
This wallet is devnet-only. Use a **different**, fresh deployer for mainnet (M10).

Also back up `packages/contracts/.keys/devnet-keeper.json` (devnet only; M7's keeper signs with it) and, after step 5, `packages/contracts/.keys/devnet-faucet.json` (devnet only; the faucet signs with it). Fund both with devnet SOL (`solana airdrop 2 <pubkey> --url devnet`): the keeper pays fees and Pyth price posts, the faucet pays fees, token accounts and its small SOL top-ups.

## 3. Rebuild and check locally (optional but recommended)

```bash
pnpm build:contracts                                  # both builds, SBPF v0, no minting code in the default build
pnpm --filter @aroma/contracts idl:check              # IDL and generated client match the program
pnpm --filter @aroma/contracts test:fixtures          # pinned Subscriptions and Pyth receiver (read-only devnet fetch)
pnpm --filter @aroma/contracts test:litesvm           # 56 cases
pnpm --filter @aroma/contracts e2e:local              # ≈ 90 s on a local validator
```

## 4. Deploy

```bash
AROMA_DEPLOYER=~/.config/solana/aroma-deployer.json bash packages/contracts/scripts/deploy-devnet.sh
```
The script checks the devnet genesis hash, the program keypair and the deployer, rebuilds, runs `solana program deploy --upgrade-authority <deployer>`, prints `solana program show` and fails unless the upgrade authority is your deployer.

If the deploy stops half-way (network, funds), the buffer keeps your SOL:
```bash
solana program show --buffers --url devnet --keypair ~/.config/solana/aroma-deployer.json
solana program close <BUFFER_ADDRESS> --url devnet --keypair ~/.config/solana/aroma-deployer.json   # recover it, then rerun step 4
```

## 5. Initialize the config

```bash
pnpm --filter @aroma/contracts devnet:init --deployer ~/.config/solana/aroma-deployer.json
```
Creates the test USD (`tUSD`, classic SPL, 6 decimals, no freeze authority) with the **devnet-only faucet key** as mint authority (M7 decision: the faucet key becomes a server secret, the deployer never does). The key is `packages/contracts/.keys/devnet-faucet.json` (git-ignored), created on the first run; pass `--faucet <pubkey>` to reuse an existing one. It refuses to run if the faucet key is the deployer, or if an earlier test USD still has the deployer as mint authority (it prints the one `spl-token authorize … mint <faucet>` command to run first). Then it calls `initialize_config` signed by the deployer (the upgrade authority) with the M6 decisions: keeper = the devnet keeper, protocol fee 0 bps, catch-up window 1, the test USD as the only funding mint, treasury = deployer, 300 bps slippage cap, 60 s staleness, 2% confidence, 500 tUSD per installment. Safe to rerun: an existing config is compared, never overwritten. State (public addresses) goes to `packages/contracts/.devnet/state.json` (git-ignored).

## 6. Register the test assets

```bash
pnpm --filter @aroma/contracts devnet:register --list                       # what will be created
pnpm --filter @aroma/contracts devnet:register --deployer ~/.config/solana/aroma-deployer.json
```
Creates xAAPL, xMSFT and xNVDA: Token-2022 mints (8 decimals, ScaledUiAmount with the live xStocks multipliers, mint authority = each asset's `["mock_mint", mint]` PDA, no freeze authority), and registers each with the real Pyth equity feed id. Safe to rerun; a timeout resumes with the same mint.

## 7. Audit (read-only)

```bash
pnpm --filter @aroma/contracts devnet:audit --deployer "$(solana-keygen pubkey ~/.config/solana/aroma-deployer.json)"
```
Must print `"passed": true` and `"transactionsSubmitted": 0`: upgrade authority = deployer, config admin = deployer, keeper = the devnet keeper, not paused, fee 0 and window 1, only the test USD allow-listed, test USD mint authority = the faucet key (not the deployer), every asset with its mock PDA as mint authority, and no freeze authorities.

## What to paste back

1. The program ID and the deploy signature (from step 4).
2. The full `solana program show FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU --url devnet` output.
3. The JSON printed by steps 5, 6 and 7.
4. `packages/contracts/.devnet/state.json`. It holds public addresses only; check that no entry has `"secretKey"`. A `secretKey` stays only for a mint whose creation did not finish; rerun step 6 instead of pasting it.

Then the agent re-runs the audit read-only, fixes anything it flags in code (not on-chain), records the deployment in `packages/guard/src/v1/deployments.ts` and the docs, re-runs the drift and build checks, and marks M6 done.

## Never

- Commit `aroma-deployer.json`, `aroma_guard-keypair.json`, `.keys/` or `.devnet/`.
- Use the devnet deployer or the devnet keeper on mainnet.
- Deploy the default (mainnet) build to devnet: it cannot execute installments (by design until M8).
