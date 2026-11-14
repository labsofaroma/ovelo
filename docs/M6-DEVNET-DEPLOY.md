# M6 devnet deploy runbook: Aroma Guard v1

_For the owner. Agents never create, read or use the deployer wallet and never sign with it; they may run read-only RPC calls and send transactions signed only by the devnet keeper or faucet keys. Everything below targets **devnet only**; every script refuses any other genesis hash._

## Deployed (devnet, 2026-11-14)

Verified: `solana program show`, the on-chain bytecode (SHA-256 of the dump = the local devnet-mock build, `20f62922…31293`), every account decoded from chain, and `devnet:audit` (`"passed": true`, `"transactionsSubmitted": 0`). Recorded in `packages/guard/src/v1/deployments.ts`.

| | Address | Signature |
|---|---|---|
| Program | [`FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU`](https://explorer.solana.com/address/FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU?cluster=devnet) (ProgramData `CZxwPDCc67PNhGoA4DLaoBuvr54Gh17ScfPKAi4h7NU7`, slot 522,224,536) | [`2BrA49su…gGvwqeaM`](https://explorer.solana.com/tx/2BrA49sugG85LQDE8oyTMzsSfSZttcvgFv1uKiv8ercRDAk1QDXppZHxvJRwCRe55VowgJdXax2eQJqwgGvwqeaM?cluster=devnet) |
| Upgrade authority = admin = treasury (deployer) | `4xAGiZM4st6S94f9sEHzLdyQ8k9Wj71rPrtcj8kGgoha` | |
| Config | [`4RkxYfgq7vFE1BNt4b2DYy27kqh9M9eQpbEYeBx4uzox`](https://explorer.solana.com/address/4RkxYfgq7vFE1BNt4b2DYy27kqh9M9eQpbEYeBx4uzox?cluster=devnet) | [`2xsXwoD6…f8RjrJ`](https://explorer.solana.com/tx/2xsXwoD6NcV177QSppSqMJWvcfCcphQrGAYph72Ggaz5SQAzrQ1QHaiM61AK8jLPhJ8yJhhBAkakiH6eo9f8RjrJ?cluster=devnet) |
| Keeper (devnet only) | `7qMWtAzRCnKR63GawKbGME4NdfLHHHoCtzWCdYXoio2j` | |
| Test USD (tUSD, classic SPL, 6 dp, no freeze) | [`2s5AcNQaXiC3GNCqK8Wh7XK8hE3pzB22KtQbMn8DZEZu`](https://explorer.solana.com/address/2s5AcNQaXiC3GNCqK8Wh7XK8hE3pzB22KtQbMn8DZEZu?cluster=devnet) | (with init) |
| tUSD mint authority = faucet (devnet only) | `JBfNfBJcAtrSmvPyre8AfHWphi3LqYFfaZgSnMYHbnrG` | |
| xAAPL mint / asset | [`3cc8PuuqcsDBmThZDy1sNdpRTpuS2yvQFF5xC69tAdpc`](https://explorer.solana.com/address/3cc8PuuqcsDBmThZDy1sNdpRTpuS2yvQFF5xC69tAdpc?cluster=devnet) / `DfvX3rB6NvEAJ5ggViz8R8LZvjF5atbWsPkJJe2nA2tW` | [`21c5jVUT…SnYJkpd`](https://explorer.solana.com/tx/21c5jVUTb6ykKcEYFkqzcDRCtE2Ca3ZGD1RGKM2mc62qFXw5BXaALYkJ83sTQ69tjw4i3ZZNhCW43ug2VsnYJkpd?cluster=devnet) |
| xMSFT mint / asset | [`3atQKQbc444RkvaPf9LNq6HePgVxqjnYYTxPao7gHjga`](https://explorer.solana.com/address/3atQKQbc444RkvaPf9LNq6HePgVxqjnYYTxPao7gHjga?cluster=devnet) / `EaZZ13udLjMcsqFzP1qJEoCYWYskdHujsUsrx3JkX7pi` | [`8Xg2NV1N…zcTa3HoQY`](https://explorer.solana.com/tx/8Xg2NV1NCWeLBmBa3S4DCUCD1dDZbfy2jMGHq9rNWQqJfwHJ92qX1YNdPtpM3ixUtjaXg5jRdb5ypzpcTa3HoQY?cluster=devnet) |
| xNVDA mint / asset | [`BM4ccDkz51k8wVvxYEnWczWeQZPMyGM6BRD4UJTDmTAy`](https://explorer.solana.com/address/BM4ccDkz51k8wVvxYEnWczWeQZPMyGM6BRD4UJTDmTAy?cluster=devnet) / `7KegVrhfFy3cqk1wSoHuv4cz1C2baXoHX4BdXG3CMGDh` | [`8VzxnRCL…SB1SdaDZM`](https://explorer.solana.com/tx/8VzxnRCL3dqo61quqPZ5uYwsAGbnh1asA1aMbfhuwK5aA3UKSYFUZ6NDT8K3fB1w8wwEX6Z26tJ23SSB1SdaDZM?cluster=devnet) |

The rest of this file is the procedure, kept for a redeploy.

| | |
|---|---|
| Program ID | `FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU` |
| Program keypair | `packages/contracts/target/deploy/aroma_guard-keypair.json` (git-ignored; generated in M6) |
| Devnet keeper (devnet only) | `7qMWtAzRCnKR63GawKbGME4NdfLHHHoCtzWCdYXoio2j`, key in `packages/contracts/.keys/devnet-keeper.json` (git-ignored) |
| Binary deployed | `target/build/devnet-mock/aroma_guard.so` (SBPF v0, 479,312 bytes) |
| Cost (measured) | ProgramData rent 2.4358 SOL, a same-size write buffer 2.4357 SOL during the deploy (refunded when it completes), ≈ 0.0025 SOL of write fees, ≈ 0.05 SOL for init and register: peak ≈ 4.93 SOL. **Fund the deployer 6 devnet SOL**, the keeper 2 and the faucet 1 (9 in total). The deploy itself used 2.44 SOL net. |
| Toolchain | Agave 3.1.10, anchor-cli 1.2.1, Node 24, pnpm 10.31 (as pinned in `packages/contracts/Anchor.toml`) |

Run everything from the repository root after `pnpm install`. Rent for another binary size: `solana rent $(( $(stat -f %z packages/contracts/target/build/devnet-mock/aroma_guard.so) + 45 )) --url devnet`.

## 1. Back up and check the program keypair

It defines the program ID. Lose it before deploying and the ID changes; lose it after and you can still upgrade with the deployer (the upgrade authority), but you cannot redeploy at the same address after closing it.

```bash
solana-keygen pubkey packages/contracts/target/deploy/aroma_guard-keypair.json
# must print FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU
node packages/contracts/scripts/check-program-id.mjs
```
Copy the file to offline storage (password manager or encrypted drive). Never commit it.

**A new worktree or clone has no program keypair** (`target/` is git-ignored). Copy the real one into `target/deploy/` before any build. `anchor build` would otherwise generate a new one, which happened once in M7 (a stray `9Z5d…` key). `build.sh` and `deploy-devnet.sh` now run `check-program-id.mjs` and refuse to build or deploy when the keypair is missing, or when its pubkey differs from `declare_id!`, any `Anchor.toml` `[programs.*]` entry or a built IDL.

## 2. Create and fund the deployer wallet (CONTRACT-V1-SPEC §10)

Create it **in your own terminal**, not through an agent session's `!` shell: `solana-keygen new` prints the seed phrase, and anything printed there lands in the session transcript. The BIP39 passphrase prompt is optional (Enter for none); it only matters when recovering from the seed phrase.
```bash
solana-keygen new -o ~/.config/solana/aroma-deployer.json   # write down the seed phrase offline
solana-keygen pubkey ~/.config/solana/aroma-deployer.json    # the only thing ever shared
```
**Never paste a private key or seed phrase into a chat, issue or log.** If it happens, treat that key as compromised and create a new one before funding it.

Funding (devnet airdrops are rate-limited per IP and often fail with "rate limit reached"):
- https://faucet.solana.com (devnet; signing in with GitHub raises the limit);
- smaller repeated airdrops a few minutes apart: `solana airdrop 1 <pubkey> --url devnet`;
- or send everything (≈ 9 SOL) to the **devnet keeper** in one go; an agent may then split it with transfers signed by the keeper only (6 to the deployer, 1 to the faucet, 2 stay with the keeper). An agent can never move SOL out of the deployer.
```bash
solana balance "$(solana-keygen pubkey ~/.config/solana/aroma-deployer.json)" --url devnet
```
This wallet is devnet-only. Use a **different**, fresh deployer for mainnet (M10).

Also back up `packages/contracts/.keys/devnet-keeper.json` and `packages/contracts/.keys/devnet-faucet.json` (both devnet only). The faucet key can be generated ahead of step 5 (`solana-keygen new --no-bip39-passphrase --silent -o packages/contracts/.keys/devnet-faucet.json`, after `git check-ignore` confirms the path) so it can be funded early; `init-devnet` reuses it. The keeper pays fees and Pyth price posts, the faucet pays fees, token accounts and its small SOL top-ups.

## 3. Rebuild and check locally (optional but recommended)

```bash
pnpm build:contracts                                  # both builds, SBPF v0, program ID check, no minting code in the default build
pnpm --filter @aroma/contracts idl:check              # IDL and generated client match the program
pnpm --filter @aroma/contracts test:fixtures          # pinned Subscriptions and Pyth receiver (read-only devnet fetch)
pnpm --filter @aroma/contracts test:litesvm
pnpm --filter @aroma/contracts e2e:local              # ≈ 90 s on a local validator
```

## 4. Deploy

```bash
AROMA_DEPLOYER=~/.config/solana/aroma-deployer.json bash "$(git rev-parse --show-toplevel)/packages/contracts/scripts/deploy-devnet.sh"
```
(Use the absolute path: an agent session's shell may sit in a subfolder, and another checkout has a different program keypair.) The script checks the devnet genesis hash, runs the program ID check before and after rebuilding, runs `solana program deploy --upgrade-authority <deployer>`, prints `solana program show` and fails unless the upgrade authority is your deployer. It took about two minutes on 2026-11-14.

If the deploy stops half-way (network, funds), the buffer keeps your SOL:
```bash
solana program show --buffers --url devnet --keypair ~/.config/solana/aroma-deployer.json
solana program close <BUFFER_ADDRESS> --url devnet --keypair ~/.config/solana/aroma-deployer.json   # recover it, then rerun step 4
```

Independent check (read-only): the deployed bytecode equals the local build.
```bash
solana program dump FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU /tmp/onchain.so --url devnet
head -c "$(stat -f %z packages/contracts/target/build/devnet-mock/aroma_guard.so)" /tmp/onchain.so | shasum -a 256
shasum -a 256 packages/contracts/target/build/devnet-mock/aroma_guard.so
```

## 5. Initialize the config

```bash
pnpm --filter @aroma/contracts devnet:init --deployer ~/.config/solana/aroma-deployer.json --dry-run   # prints deployer, keeper, faucet, config address
pnpm --filter @aroma/contracts devnet:init --deployer ~/.config/solana/aroma-deployer.json
```
Creates the test USD (`tUSD`, classic SPL, 6 decimals, no freeze authority) with the **devnet-only faucet key** as mint authority (M7 decision: the faucet key becomes a server secret, the deployer never does). The key is `packages/contracts/.keys/devnet-faucet.json` (git-ignored), created on the first run if missing; pass `--faucet <pubkey>` to reuse an existing one. It refuses to run if the faucet key is the deployer, or if an earlier test USD still has the deployer as mint authority (it prints the one `spl-token authorize … mint <faucet>` command to run first). Then it calls `initialize_config` signed by the deployer (the upgrade authority) with the M6 decisions: keeper = the devnet keeper, protocol fee 0 bps, catch-up window 1, the test USD as the only funding mint, treasury = deployer, 300 bps slippage cap, 60 s staleness, 2% confidence, 500 tUSD per installment. Safe to rerun: an existing config is compared, never overwritten. State (public addresses) goes to `packages/contracts/.devnet/state.json` (git-ignored). The `bigint: Failed to load bindings` line is harmless.

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
- Paste a private key or seed phrase anywhere, or create a key through an agent session's shell.
- Use the devnet deployer or the devnet keeper on mainnet.
- Deploy the default (mainnet) build to devnet: it cannot execute installments (by design until M8).
