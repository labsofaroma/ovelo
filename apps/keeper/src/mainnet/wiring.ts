import type { Config } from "@aroma/guard";
import type { KeeperEnv } from "../env";
import type { ExecuteDeps } from "../execute";
import { mainnetBatchRunner } from "./batch";
import { isMainnetCluster } from "./env";
import { jitoSubmitter } from "./jito";
import { jupiterClient } from "./jupiter";

/** What a mainnet-mode run adds to ExecuteDeps; nothing on devnet or localnet. */
export type ExecuteMode = Pick<
  ExecuteDeps,
  "runBatch" | "maxLegsPerTransaction"
>;

export function executeMode(
  env: Pick<
    KeeperEnv,
    | "KEEPER_CLUSTER"
    | "KEEPER_JUPITER_URL"
    | "JUPITER_API_KEY"
    | "KEEPER_JITO_URL"
    | "KEEPER_JITO_TIP_LAMPORTS"
    | "KEEPER_MAINNET_LEGS_PER_TX"
  >,
  get: typeof fetch = fetch,
): ExecuteMode {
  if (!isMainnetCluster(env.KEEPER_CLUSTER)) return {};
  return {
    maxLegsPerTransaction: env.KEEPER_MAINNET_LEGS_PER_TX,
    runBatch: mainnetBatchRunner({
      jupiter: jupiterClient({
        baseUrl: env.KEEPER_JUPITER_URL,
        apiKey: env.JUPITER_API_KEY,
        fetch: get,
      }),
      jito: env.KEEPER_JITO_URL
        ? {
            submit: jitoSubmitter(env.KEEPER_JITO_URL, get),
            tipLamports: BigInt(env.KEEPER_JITO_TIP_LAMPORTS),
          }
        : undefined,
    }),
  };
}

/** M8 decision 1: the mainnet build is keeper-only, so a config without a keeper cannot run. */
export function assertMainnetKeeper(
  cluster: string,
  config: Pick<Config, "keeperAuthority">,
) {
  if (isMainnetCluster(cluster) && config.keeperAuthority.__option !== "Some")
    throw new Error(
      "The mainnet build is keeper-only and this config has no keeper_authority; refusing to run",
    );
}
