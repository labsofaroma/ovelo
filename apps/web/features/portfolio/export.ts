import "server-only";
import { getMarkets } from "../markets/server";
import { receiptsReader } from "../trade/server/deps";
import { mainnetRpc } from "../trade/server/rpc";
import { testSwitchesAllowed } from "@/server/env.schema";
import { AppError } from "@/server/errors";
import { createRateLimiter, type RateLimiter } from "@/server/ratelimit";
import { getRedis } from "@/server/redis";
import { portfolioCsv } from "./pnl/csv";
import { loadPnlData } from "./pnl/service";
import { getPortfolio } from "./server";

/** CSV export for the signed-in wallet only (session scope `portfolio`), 5 per 10 minutes. */
let limiter: RateLimiter | null = null;
export async function assertExportAllowed(wallet: string): Promise<void> {
  limiter ??= createRateLimiter({
    name: "portfolio:export",
    limit: 5,
    windowSeconds: 600,
    redis: getRedis(),
    required: !testSwitchesAllowed(process.env),
  });
  const decision = await limiter.check(wallet);
  if (!decision.allowed)
    throw new AppError("RATE_LIMITED", {
      publicMessage: "Up to 5 downloads per 10 minutes. Try again shortly.",
      detail: "portfolio export limit",
    });
}

export async function exportCsv(wallet: string): Promise<string> {
  const markets = await getMarkets();
  const view = markets.state === "ok" ? markets.data : null;
  const portfolio = await getPortfolio(wallet, {
    rpc: mainnetRpc,
    markets: async () => view,
  });
  const rows = await receiptsReader().listByWallet(wallet, 200);
  const data = await loadPnlData(wallet, portfolio.holdings, rows, view);
  return portfolioCsv(data);
}
