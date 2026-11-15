# Keeper: mainnet mode (M8)

_Off everywhere until M12._ No deploy config sets `KEEPER_CLUSTER=mainnet`. This file covers the mainnet mode only; devnet operations are in [keeper-operations.md](./keeper-operations.md). The program side is in [ovelo-guard-v1.md](./ovelo-guard-v1.md#mainnet-execution-default-build).

## What changes from devnet

| | devnet / localnet | mainnet (`KEEPER_CLUSTER=mainnet`) |
|---|---|---|
| Key | `KEEPER_KEYPAIR` (devnet-only) | **`KEEPER_MAINNET_KEYPAIR`**, a separate key; boot fails if `KEEPER_KEYPAIR` is also set, or if the two are equal. The mainnet key is refused on devnet and localnet |
| Genesis | devnet's (or the local validator's) | **mainnet's** (`5eykt4Us…2N9d`), checked at boot and for every RPC client; mainnet's genesis is refused in every other mode |
| Config | keeper optional | **keeper required**: the program refuses execution without `keeper_authority` (M8 decision 1), and so does the keeper |
| Instruction | `execute_installment` | `execute_installment_routed`, one Jupiter `route_v2` per leg |
| Legs per transaction | ≤ 3 | **≤ 2** (`KEEPER_MAINNET_LEGS_PER_TX`, 1–2); one per transaction when the measured size exceeds 1,232 bytes |
| Price age | ≤ `max_oracle_staleness_s` | ≤ `min(max_oracle_staleness_s, 20 s)`; the keeper requires a Hermes update at most 10 s old |
| Sending | RPC | RPC, or the Jito block engine (`KEEPER_JITO_URL`, with a tip) |

The same leases, retries, dead-letter list, alerts, reconcile step and receipts are used as on devnet. The routed batch runner is injected into `executePlan` (`src/mainnet/batch.ts`).

## One leg batch

1. **Accounts:** the owner's output ATAs, the treasury's funding ATA, and the swap authority's funding ATA and transit ATA per output mint are created idempotently when missing. The keeper pays.
2. **Routes:** one Jupiter Swap API v2 `/build` per leg, with:
   - `taker` = the program's swap authority;
   - `destinationTokenAccount` = the owner's ATA;
   - `amount` = leg funding minus the protocol fee;
   - `slippageBps` = the output's slippage, capped at 300;
   - `onlyDirectRoutes=true`, `wrapAndUnwrapSol=false`.

   Each build is then checked twice:
   - by M4's reviewed ExactIn validator (now `@ovelo/guard/jupiter`): full Borsh walk, no trailing bytes, amounts, fees, settlement accounts;
   - for direct routes only: every step swaps the funding mint for the output mint.

   The routed builder then repeats the program's prefix and forbidden-account checks before anything is signed.
3. **Lookup tables:** the tables Jupiter names are read from chain and must be owned by the lookup-table program, active, and contain every address at the index Jupiter relied on (M4's rules).
4. **Prices:** fresh, fully verified Pyth posts, as on devnet.
5. **Execute:** simulate (the program's error is permanent and dead-letters), set priority fees and the compute limit from the simulation, then send and confirm. Receipts are written from the `InstallmentExecuted` event.
6. **Cleanup:** price accounts are closed for rent.

A route failure (no route, rate limit, invalid build, intermediate-mint route) dead-letters the batch as `ROUTE_UNAVAILABLE` and alerts `installment_failed`. The next run retries the period while it is still in the catch-up window.

## Environment (mainnet only)

| Variable | |
|---|---|
| `KEEPER_CLUSTER=mainnet` | the switch; off until M12 |
| `KEEPER_MAINNET_KEYPAIR` | the mainnet keeper key (secret store, P4); `= config.keeper_authority` on mainnet |
| `KEEPER_RPC_URL` | a paid mainnet RPC over `https://` (P3); devnet and testnet hosts are refused |
| `JUPITER_API_KEY` | required in production (keyless limits leave most routes unavailable) |
| `KEEPER_JUPITER_URL` | default `https://api.jup.ag` |
| `PYTH_API_KEY`, `HERMES_URL` | Hermes; the key is required in production |
| `KEEPER_JITO_URL`, `KEEPER_JITO_TIP_LAMPORTS` | optional; a Jito URL needs a non-zero tip |
| `KEEPER_MAINNET_LEGS_PER_TX` | 1 or 2 (default 2) |
| `KEEPER_PRIORITY_MICROLAMPORTS` | priority fee, as on devnet |

Every URL must be `https://`. The local test mode `KEEPER_CLUSTER=mainnet-fork` needs `KEEPER_ALLOW_FORK=true`, `KEEPER_FORK_GENESIS` and a loopback RPC, and is refused in production. It is used only by `pnpm --filter @ovelo/contracts e2e:fork`.

## Before turning it on (M12, owner)

1. The program is deployed to mainnet, and `initialize_config` has `keeper_authority` = the mainnet keeper key, USDC allow-listed, and the xStocks issuer keys on the Token-2022 allow-lists.
2. Each catalog xStock is registered with its Pyth equity feed. A direct USDC route exists for each (check with the Jupiter build API).
3. Fund the mainnet keeper key (rent for the swap-authority ATAs, posts and fees). Set the alert webhook and `KEEPER_MIN_SOL_LAMPORTS`.
4. Run `pnpm --filter @ovelo/contracts test:fixtures:mainnet && … test:litesvm:subscriptions-mainnet`. These must pass on the binaries then on mainnet.
5. A capped plan runs real installments, then close + revoke (P5).
