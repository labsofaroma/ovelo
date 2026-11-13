import "server-only";
import { getMarkets } from "../markets/server";
import { receiptsReader } from "../trade/server/deps";
import { mainnetRpc } from "../trade/server/rpc";
import { logger } from "@/server/logger";
import type { ActivityItem, PortfolioView } from "./schema";
import { getPortfolio, toActivity } from "./server";

/** GET /api/v1/portfolio/:wallet: holdings (chain) + activity (our receipts), never mixed up. */
export async function loadPortfolio(wallet: string): Promise<{
  portfolio: PortfolioView;
  activity: ActivityItem[] | null;
}> {
  const portfolio = await getPortfolio(wallet, {
    rpc: mainnetRpc,
    markets: async () => {
      const markets = await getMarkets();
      return markets.state === "ok" ? markets.data : null;
    },
  });
  let activity: ActivityItem[] | null = null;
  try {
    activity = toActivity(await receiptsReader().listByWallet(wallet, 50));
  } catch (err) {
    // Receipts storage down: say so (null), never show an empty history as if there were none.
    logger.warn({ err }, "activity unavailable");
  }
  return { portfolio, activity };
}
