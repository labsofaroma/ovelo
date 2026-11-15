import {
  createSolanaRpc,
  createSolanaRpcFromTransport,
  type RpcTransport,
} from "@solana/kit";
import { DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH } from "@ovelo/guard";
import type { KeeperEnv } from "./env";

export type KeeperRpc = ReturnType<
  typeof createSolanaRpcFromTransport<RpcTransport>
>;

export class WrongClusterError extends Error {
  constructor(readonly reported: string) {
    super(
      "The keeper RPC reported a genesis other than the expected cluster's; refusing to sign anything.",
    );
    this.name = "WrongClusterError";
  }
}

type ClusterEnv = Pick<
  KeeperEnv,
  "KEEPER_CLUSTER" | "KEEPER_LOCALNET_GENESIS" | "KEEPER_FORK_GENESIS"
>;

/**
 * The genesis each cluster must report: devnet's; the configured local validator's; mainnet's
 * (mainnet mode only, M8); the configured local mainnet fork's.
 */
export function expectedGenesis(env: ClusterEnv): string {
  switch (env.KEEPER_CLUSTER) {
    case "localnet":
      return env.KEEPER_LOCALNET_GENESIS!;
    case "mainnet":
      return MAINNET_GENESIS_HASH;
    case "mainnet-fork":
      return env.KEEPER_FORK_GENESIS!;
    default:
      return DEVNET_GENESIS_HASH;
  }
}

/**
 * A genesis-checked RPC client (AGENTS.md rule 3): called at boot and for every client the keeper
 * creates, so the devnet-only keeper key can never sign for mainnet, and the mainnet key (a
 * separate variable, mainnet/env.ts) only ever signs for mainnet. Returns the check's latency.
 */
export async function connectRpc(
  env: ClusterEnv & Pick<KeeperEnv, "KEEPER_RPC_URL">,
  transport?: RpcTransport,
): Promise<{ rpc: KeeperRpc; latencyMs: number }> {
  const rpc = transport
    ? createSolanaRpcFromTransport(transport)
    : (createSolanaRpc(env.KEEPER_RPC_URL) as unknown as KeeperRpc);
  const started = Date.now();
  const genesis = await rpc.getGenesisHash().send();
  const expected = expectedGenesis(env);
  if (genesis !== expected) throw new WrongClusterError(genesis);
  if (env.KEEPER_CLUSTER !== "mainnet" && genesis === MAINNET_GENESIS_HASH)
    throw new WrongClusterError(genesis);
  if (
    (env.KEEPER_CLUSTER === "localnet" ||
      env.KEEPER_CLUSTER === "mainnet-fork") &&
    genesis === DEVNET_GENESIS_HASH
  )
    throw new WrongClusterError(genesis);
  return { rpc, latencyMs: Date.now() - started };
}
