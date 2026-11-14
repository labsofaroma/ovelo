import "server-only";
import { headers } from "next/headers";
import { getEnv } from "@/server/env";
import { mapError } from "@/server/errors";
import { logger } from "@/server/logger";
import { devnetConfig, localnetConfig } from "../wallet/cluster";
import type { InvestPageData } from "./components/types";
import { NOT_DEPLOYED_MESSAGE } from "./components/InvestUnavailable";
import { basketOptions, buildCatalog } from "./server/catalog";
import { readAssets, readConfig, readMint } from "./server/chain";
import { resolveInvestNetwork } from "./server/cluster";
import { productionServices } from "./server/deps";
import { FAUCET_TEST_USD_RAW } from "./server/faucet";
import { FUNDING_SYMBOL } from "./server/prepare";

/**
 * Server data for /v1/invest. Unavailable (with an honest message) while the devnet deployment
 * record is null, when localnet is not a test build, or when the chain cannot be read.
 */
export type InvestPageResult =
  | { state: "ok"; data: InvestPageData }
  | { state: "unavailable"; cluster: "devnet" | "localnet"; message: string };

export async function loadInvestPage(): Promise<InvestPageResult> {
  const env = getEnv();
  const resolved = resolveInvestNetwork(env);
  if (!resolved.available)
    return {
      state: "unavailable",
      cluster: resolved.cluster,
      message:
        resolved.reason === "not_deployed"
          ? NOT_DEPLOYED_MESSAGE
          : "Recurring investing is not configured on this deployment.",
    };
  const { network } = resolved;
  const wallet =
    network.cluster === "devnet"
      ? devnetConfig(network.browserRpcUrl)
      : localnetConfig(network.rpcUrl, network.deployment.genesisHash);
  if (!wallet)
    return {
      state: "unavailable",
      cluster: network.cluster,
      message: "This build cannot use a local validator.",
    };
  try {
    const { rpc } = await productionServices.context();
    const [config, assets, mint, sources] = await Promise.all([
      readConfig(rpc),
      readAssets(rpc, network.deployment.programId),
      readMint(rpc, network.deployment.fundingMint),
      productionServices.baskets(),
    ]);
    const catalog = buildCatalog(assets);
    return {
      state: "ok",
      data: {
        wallet,
        cluster: network.cluster,
        explorerRpcUrl: network.browserRpcUrl,
        assets: catalog.map((a) => ({
          mint: a.mint,
          symbol: a.symbol,
          name: a.name,
          enabled: a.enabled,
        })),
        baskets: basketOptions(sources, catalog).map((b) => ({
          ...b,
          outputs: b.outputs.map((o) => ({
            mint: o.mint,
            symbol: o.symbol,
            weightBps: o.weightBps,
          })),
        })),
        catchUpWindowPeriods: config.catchUpWindowPeriods,
        maxInstallmentRaw: config.maxInstallmentAmount.toString(),
        fundingSymbol: FUNDING_SYMBOL,
        fundingDecimals: mint.decimals,
        turnstileSiteKey: env.public.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null,
        faucetAmountRaw: FAUCET_TEST_USD_RAW.toString(),
        nonce: (await headers()).get("x-nonce"),
      },
    };
  } catch (error) {
    logger.warn({ err: error }, "invest page: chain read failed");
    return {
      state: "unavailable",
      cluster: network.cluster,
      message: mapError(error).body.message,
    };
  }
}
