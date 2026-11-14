import "server-only";
import { keyringFromEnv } from "@/server/auth/trade";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { requireRedis } from "@/server/redis";
import { clientIp } from "@/server/request-guard";
import { listPublishedBaskets } from "@/features/creators/server";
import { getMarkets } from "@/features/markets/server";
import type { BasketSource } from "./catalog";
import { requireInvestNetwork, verifiedRpc } from "./cluster";
import { DEFAULT_DAILY_CLAIMS } from "./faucet-limits";
import { upstashCommands } from "./redis";
import type { InvestServices } from "./routes";
import { dbInvestStore } from "./store";

/**
 * Production wiring. Redis (idempotency, faucet limits) and Postgres (plans_index, receipts) are
 * required: without them the feature is unavailable, never silently degraded. Locally the same
 * clients point at the Docker Postgres + Neon proxy and the Docker Redis behind an Upstash-
 * compatible REST proxy (scripts/local-db.sh, scripts/local-redis.sh).
 */

async function basketSources(): Promise<BasketSource[]> {
  const sources: BasketSource[] = [];
  const markets = await getMarkets();
  if (markets.state === "ok")
    for (const basket of markets.data.baskets)
      sources.push({
        id: basket.id,
        name: basket.name,
        kind: "curated",
        members: basket.members,
      });
  else
    logger.warn(
      { code: markets.error.code },
      "invest: curated baskets unavailable",
    );
  try {
    for (const basket of await listPublishedBaskets(getDb()))
      sources.push({
        id: basket.id,
        name: basket.name,
        kind: "creator",
        members: basket.allocations,
      });
  } catch (err) {
    logger.warn({ err }, "invest: creator baskets unavailable");
  }
  return sources;
}

function faucetKey(): Uint8Array {
  const raw = getEnv().devnet.AROMA_V1_FAUCET_KEYPAIR;
  if (!raw)
    throw new AppError("SERVICE_UNAVAILABLE", {
      publicMessage: "The test faucet is not configured right now.",
      detail: "AROMA_V1_FAUCET_KEYPAIR is not set",
    });
  return Uint8Array.from(JSON.parse(raw) as number[]);
}

export const productionServices: InvestServices = {
  async context() {
    const network = requireInvestNetwork(getEnv());
    return { network, rpc: await verifiedRpc(network) };
  },
  keyring: () => keyringFromEnv(),
  store: () => dbInvestStore(getDb()),
  redis: () => upstashCommands(requireRedis()),
  baskets: basketSources,
  faucet() {
    const env = getEnv();
    const turnstileSecret = env.devnet.TURNSTILE_SECRET_KEY;
    if (!turnstileSecret)
      throw new AppError("SERVICE_UNAVAILABLE", {
        publicMessage: "The test faucet is not configured right now.",
        detail: "TURNSTILE_SECRET_KEY is not set",
      });
    return {
      key: faucetKey(),
      turnstileSecret,
      dailyClaims: Number(
        env.devnet.AROMA_V1_FAUCET_DAILY_CLAIMS ?? DEFAULT_DAILY_CLAIMS,
      ),
    };
  },
  clientIp: (request) => clientIp(request.headers, process.env),
};
