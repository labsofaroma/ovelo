import "server-only";
import {
  createSolanaRpc,
  createSolanaRpcFromTransport,
  type Address,
  type RpcTransport,
} from "@solana/kit";
import {
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  V1_DEPLOYMENTS,
  V1_PROGRAM_ID,
} from "@aroma/guard";
import type { Env } from "@/server/env.schema";
import { testSwitchesAllowed } from "@/server/env.schema";
import { AppError } from "@/server/errors";
import type { InvestClusterName } from "../schema";

/**
 * Which cluster `/v1/invest` runs on and where the program is (M7 B0/B2).
 *
 * - devnet: the deployment comes from `V1_DEPLOYMENTS.devnet`. While it is `null` (the owner has
 *   not deployed yet) the feature is UNAVAILABLE: every route answers INVEST_UNAVAILABLE and the
 *   page says so. Nothing is faked.
 * - localnet: a local validator for the E2E, only with test switches allowed and never in
 *   production (the env schema enforces both); its genesis and test USD come from env.
 *
 * Every RPC client is genesis-checked when it is created (AGENTS.md rule 3): devnet must report
 * devnet's genesis, localnet the configured one (and never mainnet's or devnet's).
 */

export const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

export type InvestDeployment = {
  programId: Address;
  fundingMint: Address;
  genesisHash: string;
};

export type InvestNetwork = {
  cluster: InvestClusterName;
  /** Server-side RPC endpoint (never sent to the browser for devnet). */
  rpcUrl: string;
  /** Browser RPC endpoint the wallet boundary checks. */
  browserRpcUrl: string;
  deployment: InvestDeployment;
};

export type NetworkResolution =
  | { available: true; network: InvestNetwork }
  | {
      available: false;
      cluster: InvestClusterName;
      reason: "not_deployed" | "misconfigured";
    };

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;

export function resolveInvestNetwork(env: Env): NetworkResolution {
  if (env.devnet.AROMA_V1_INVEST_CLUSTER === "localnet") {
    const rpcUrl = env.devnet.AROMA_V1_LOCALNET_RPC_URL;
    const genesisHash = env.devnet.AROMA_V1_LOCALNET_GENESIS;
    const fundingMint = env.devnet.AROMA_V1_LOCALNET_FUNDING_MINT;
    const allowed =
      env.server.VERCEL_ENV !== "production" &&
      env.public.NEXT_PUBLIC_AROMA_LOCALNET === "true" &&
      testSwitchesAllowed({
        NODE_ENV: env.server.NODE_ENV,
        AROMA_V1_ALLOW_TEST_SWITCHES: env.server.AROMA_V1_ALLOW_TEST_SWITCHES
          ? "true"
          : "false",
        VERCEL_ENV: env.server.VERCEL_ENV,
      });
    if (
      !allowed ||
      !rpcUrl ||
      !LOOPBACK.test(rpcUrl) ||
      !genesisHash ||
      !fundingMint ||
      genesisHash === DEVNET_GENESIS_HASH ||
      genesisHash === MAINNET_GENESIS_HASH
    )
      return { available: false, cluster: "localnet", reason: "misconfigured" };
    return {
      available: true,
      network: {
        cluster: "localnet",
        rpcUrl,
        browserRpcUrl: rpcUrl,
        deployment: {
          programId: V1_PROGRAM_ID,
          fundingMint: fundingMint as Address,
          genesisHash,
        },
      },
    };
  }
  const deployment = V1_DEPLOYMENTS.devnet;
  if (!deployment)
    return { available: false, cluster: "devnet", reason: "not_deployed" };
  if (
    deployment.cluster !== "devnet" ||
    deployment.genesisHash !== DEVNET_GENESIS_HASH ||
    deployment.programId !== V1_PROGRAM_ID
  )
    return { available: false, cluster: "devnet", reason: "misconfigured" };
  return {
    available: true,
    network: {
      cluster: "devnet",
      rpcUrl: env.devnet.AROMA_RECURRING_RPC_URL ?? DEFAULT_DEVNET_RPC,
      browserRpcUrl:
        env.public.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL ?? DEFAULT_DEVNET_RPC,
      deployment: {
        programId: deployment.programId,
        fundingMint: deployment.fundingMint,
        genesisHash: deployment.genesisHash,
      },
    },
  };
}

/** The network, or INVEST_UNAVAILABLE (honest "not on devnet yet"). */
export function requireInvestNetwork(env: Env): InvestNetwork {
  const resolved = resolveInvestNetwork(env);
  if (!resolved.available)
    throw new AppError("INVEST_UNAVAILABLE", {
      detail: `${resolved.cluster}: ${resolved.reason}`,
    });
  return resolved.network;
}

export type InvestRpc = ReturnType<
  typeof createSolanaRpcFromTransport<RpcTransport>
>;

/**
 * A kit RPC client for the network, refused unless the node reports the expected genesis.
 * `transport` is injected by tests; production builds the default HTTP transport.
 */
export async function verifiedRpc(
  network: InvestNetwork,
  transport?: RpcTransport,
): Promise<InvestRpc> {
  const rpc = transport
    ? createSolanaRpcFromTransport(transport)
    : (createSolanaRpc(network.rpcUrl) as unknown as InvestRpc);
  let genesis: string;
  try {
    genesis = await rpc.getGenesisHash().send();
  } catch (cause) {
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: `${network.cluster} RPC is unavailable`,
      cause,
    });
  }
  const expected = network.deployment.genesisHash;
  if (
    genesis !== expected ||
    (network.cluster === "localnet" &&
      (genesis === MAINNET_GENESIS_HASH || genesis === DEVNET_GENESIS_HASH))
  )
    throw new AppError("WRONG_CLUSTER", {
      detail: `${network.cluster} RPC reported a different cluster's genesis`,
    });
  return rpc;
}
