import "server-only";
import { aggregateTokenBalances } from "@/lib/sdk/trade/holdings";
import { AppError } from "@/server/errors";
import type { MarketsView } from "../markets/schema";
import { assertMainnet, type MainnetRpc } from "../trade/server/rpc";
import type { ReceiptRow } from "../trade/server/store";
import {
  activityItemSchema,
  portfolioViewSchema,
  type ActivityItem,
  type Holding,
  type PortfolioView,
} from "./schema";
import { sumFixed, valueOf } from "./valuation";

/**
 * Wallet holdings from mainnet (balances) valued with the cached issuer snapshot (prices with
 * source and as-of). Ported in spirit from lib/server/holdings.ts on lib/sdk. The RPC must
 * report the mainnet genesis first; nothing here writes anything.
 */

const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
] as const;
const MAX_HOLDINGS = 200;

export async function getPortfolio(
  wallet: string,
  deps: {
    rpc: MainnetRpc;
    markets: () => Promise<MarketsView | null>;
    now?: () => number;
  },
): Promise<PortfolioView> {
  await assertMainnet(deps.rpc);
  const [lamports, ...tokenAccounts] = await Promise.all([
    deps.rpc<{ value: number }>("getBalance", [
      wallet,
      { commitment: "confirmed" },
    ]),
    ...TOKEN_PROGRAMS.map((programId) =>
      deps.rpc<{ value: unknown[] }>("getTokenAccountsByOwner", [
        wallet,
        { programId },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]),
    ),
  ]);
  const observedAt = new Date(deps.now?.() ?? Date.now()).toISOString();
  const balances = aggregateTokenBalances(
    tokenAccounts.flatMap((result) =>
      Array.isArray(result.value) ? result.value : [],
    ),
    wallet,
  ).filter((balance) => BigInt(balance.rawAmount) > 0n);
  const view = await deps.markets().catch(() => null);
  const rows = new Map((view?.rows ?? []).map((row) => [row.mint, row]));
  const warnings: string[] = [];
  if (!view)
    warnings.push(
      "Market prices are unavailable right now; holdings are shown without values.",
    );
  if (balances.length > MAX_HOLDINGS)
    warnings.push(`Showing the first ${MAX_HOLDINGS} token accounts.`);
  const holdings: Holding[] = balances.slice(0, MAX_HOLDINGS).map((balance) => {
    const row = rows.get(balance.mint);
    const price = row?.price ?? null;
    return {
      mint: balance.mint,
      symbol: row?.symbol ?? "Unknown token",
      name: row?.name ?? "Not in the issuer catalog",
      decimals: balance.decimals,
      raw: balance.rawAmount,
      catalog: Boolean(row),
      issuer: row?.issuer ?? null,
      logoUrl: row?.logoUrl ?? null,
      price,
      priceObservedAt: row?.priceObservedAt ?? null,
      priceSource: row?.priceSource ?? null,
      value: valueOf(balance.rawAmount, balance.decimals, price),
    };
  });
  holdings.sort(
    (a, b) =>
      Number(b.catalog) - Number(a.catalog) ||
      compareValue(b, a) ||
      a.symbol.localeCompare(b.symbol),
  );
  const priced = holdings.flatMap((h) => (h.value ? [h.value] : []));
  if (!Number.isSafeInteger(lamports.value) || lamports.value < 0)
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: "invalid SOL balance",
    });
  return portfolioViewSchema.parse({
    wallet,
    network: "mainnet-beta",
    observedAt,
    sol: { raw: String(lamports.value), decimals: 9 },
    holdings,
    pricedValue: sumFixed(priced),
    unpricedCount: holdings.length - priced.length,
    pricesAsOf: view?.asOf ?? null,
    sources: ["Solana mainnet RPC balances", ...(view?.sources ?? [])],
    warnings,
  });
}

function compareValue(a: Holding, b: Holding): number {
  if (!a.value && !b.value) return 0;
  if (!a.value) return -1;
  if (!b.value) return 1;
  const scale = Math.max(a.value.decimals, b.value.decimals);
  const av = BigInt(a.value.raw) * 10n ** BigInt(scale - a.value.decimals);
  const bv = BigInt(b.value.raw) * 10n ** BigInt(scale - b.value.decimals);
  return av === bv ? 0 : av > bv ? 1 : -1;
}

/** Receipt rows → activity items (only what was recorded; nothing inferred). */
export function toActivity(rows: readonly ReceiptRow[]): ActivityItem[] {
  return rows.map((row) => {
    const legs = (row.legs as Record<string, unknown>[]).filter(
      (leg) => leg && typeof leg === "object",
    );
    return activityItemSchema.parse({
      signature: row.signature,
      kind: row.kind,
      status: row.status,
      mintIn: row.mintIn,
      amountIn: row.amountIn,
      legs: legs.map((leg) => ({
        mint: String(leg.mint),
        outAmount: String(leg.outAmount),
        minimumAmount: String(leg.minimumAmount),
      })),
      basket: typeof legs[0]?.basket === "string" ? legs[0].basket : null,
      blockTime: row.blockTime?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  });
}
