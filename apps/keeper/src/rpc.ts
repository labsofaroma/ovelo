import {
  createSolanaRpc,
  createSolanaRpcFromTransport,
  type RpcTransport,
} from "@solana/kit";
import { DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH } from "@aroma/guard";
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

/** Devnet's genesis, or the configured local validator's (never mainnet's or devnet's then). */
export function expectedGenesis(
  env: Pick<KeeperEnv, "KEEPER_CLUSTER" | "KEEPER_LOCALNET_GENESIS">,
): string {
  return env.KEEPER_CLUSTER === "localnet"
    ? env.KEEPER_LOCALNET_GENESIS!
    : DEVNET_GENESIS_HASH;
}

/**
 * A genesis-checked RPC client (AGENTS.md rule 3): called at boot and for every client the keeper
 * creates, so the devnet-only keeper key can never sign for mainnet. Returns the check's latency.
 */
export async function connectRpc(
  env: Pick<
    KeeperEnv,
    "KEEPER_CLUSTER" | "KEEPER_LOCALNET_GENESIS" | "KEEPER_RPC_URL"
  >,
  transport?: RpcTransport,
): Promise<{ rpc: KeeperRpc; latencyMs: number }> {
  const rpc = transport
    ? createSolanaRpcFromTransport(transport)
    : (createSolanaRpc(env.KEEPER_RPC_URL) as unknown as KeeperRpc);
  const started = Date.now();
  const genesis = await rpc.getGenesisHash().send();
  const expected = expectedGenesis(env);
  if (genesis === MAINNET_GENESIS_HASH || genesis !== expected)
    throw new WrongClusterError(genesis);
  if (env.KEEPER_CLUSTER === "localnet" && genesis === DEVNET_GENESIS_HASH)
    throw new WrongClusterError(genesis);
  return { rpc, latencyMs: Date.now() - started };
}
