import "server-only";
import { getMarkets } from "../markets/server";
import { receiptsReader } from "../trade/server/deps";
import { mainnetRpc } from "../trade/server/rpc";
import { logger } from "@/server/logger";
import { loadPnl } from "./pnl/service";
import type { PnlView } from "./pnl/schema";
import type { ActivityItem, PortfolioView } from "./schema";
import { getPortfolio, toActivity } from "./server";

/**
 * GET /api/v1/portfolio/:wallet: holdings (chain) + activity (our receipts), never mixed up, and
 * (M11) P&L from those receipts' exact fills. `pnl` is null when receipts are unavailable.
 */
export async function loadPortfolio(wallet: string): Promise<{
  portfolio: PortfolioView;
  activity: ActivityItem[] | null;
  pnl: PnlView | null;
}> {
  let markets: Awaited<ReturnType<typeof getMarkets>> | null = null;
  const marketsView = async () => {
    markets ??= await getMarkets();
    return markets.state === "ok" ? markets.data : null;
  };
  const portfolio = await getPortfolio(wallet, {
    rpc: mainnetRpc,
    markets: marketsView,
  });
  let activity: ActivityItem[] | null = null;
  let pnl: PnlView | null = null;
  try {
    const rows = await receiptsReader().listByWallet(wallet, 50);
    activity = toActivity(rows);
    pnl = await loadPnl(
      wallet,
      portfolio.holdings,
      rows,
      await marketsView().catch(() => null),
    ).catch((err: unknown) => {
      logger.warn({ err }, "pnl unavailable");
      return null;
    });
  } catch (err) {
    // Receipts storage down: say so (null), never show an empty history as if there were none.
    logger.warn({ err }, "activity unavailable");
  }
  return { portfolio, activity, pnl };
}
