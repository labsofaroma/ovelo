import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { FUNDING_TOKENS } from "@/features/trade/schema";
import { baskets, creators, receipts } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import type { CreatorsDb } from "./db";
import type { CreatorStatsView, UsageView, UsageWindow } from "./schema";

/**
 * Creator stats: what the registry records (baskets, versions, publish dates) and usage from
 * purchase receipts (M5b B5, M5-NEEDS-FROM-M4 #4). PRODUCT.md: never invent creator metrics.
 *
 * - Only CONFIRMED basket receipts count; pending and failed ones never do.
 * - A purchase is one order (one request id), even when a bundle spans several transactions.
 * - Volume is the sum of each receipt's raw input amount (integer text, exact `numeric` sum in
 *   Postgres), per funding mint: never converted, never added across mints.
 * - Windows are by order time: when Aroma recorded the order (`created_at`, the server's own
 *   clock, within seconds of confirmation), relative to `asOf`. Not the chain's block time, which
 *   can run ahead of the server clock (and does, by hours, on a warped local fork).
 * - No confirmed purchase at all is `state: "none"` ("no purchases yet"), never zero volume.
 */
export const STATS_SOURCE = "Aroma creator registry (Postgres)";
export const USAGE_SOURCE =
  "Aroma purchase receipts: confirmed Solana mainnet transactions";
export const USAGE_WINDOWS = [
  { window: "7d", days: 7 },
  { window: "30d", days: 30 },
  { window: "all", days: null },
] as const;

const DAY_MS = 86_400_000;
const at = sql`${receipts.createdAt}`;
const order = sql`coalesce(${receipts.legs}->0->>'requestId', ${receipts.signature})`;

/** Usage of one basket, or of every basket of one creator, from confirmed receipts. */
export async function receiptUsage(
  db: CreatorsDb,
  scope: { basketId: string } | { creatorWallet: string },
  now: Date = new Date(),
): Promise<UsageView> {
  const asOf = now.toISOString();
  const since = USAGE_WINDOWS.map((w) =>
    w.days === null ? null : new Date(now.getTime() - w.days * DAY_MS),
  );
  const inWindow = (i: number): SQL =>
    since[i]
      ? sql`${at} >= ${since[i]!.toISOString()}::timestamptz`
      : sql`true`;
  const where = and(
    eq(receipts.status, "confirmed"),
    eq(receipts.kind, "basket"),
    "basketId" in scope
      ? eq(receipts.basketId, scope.basketId)
      : eq(baskets.creatorWallet, scope.creatorWallet),
    // Nothing recorded after as-of (a fixed clock in tests; never true in production).
    sql`${at} <= ${asOf}::timestamptz`,
  );
  const base = () =>
    db
      .select({
        purchases: sql<number>`count(distinct ${order})::int`,
        buyers: sql<number>`count(distinct ${receipts.wallet})::int`,
      })
      .from(receipts)
      .innerJoin(baskets, eq(baskets.id, receipts.basketId));
  const counts = await Promise.all(
    USAGE_WINDOWS.map((_, i) => base().where(and(where, inWindow(i)))),
  );
  if (!counts[2]?.[0]?.purchases)
    return { state: "none", asOf, source: USAGE_SOURCE };
  const volumes = await Promise.all(
    USAGE_WINDOWS.map((_, i) =>
      db
        .select({
          mint: receipts.mintIn,
          raw: sql<string>`sum(${receipts.amountIn}::numeric)::text`,
        })
        .from(receipts)
        .innerJoin(baskets, eq(baskets.id, receipts.basketId))
        .where(and(where, inWindow(i)))
        .groupBy(receipts.mintIn)
        .orderBy(receipts.mintIn),
    ),
  );
  const windows: UsageWindow[] = USAGE_WINDOWS.map((w, i) => ({
    window: w.window,
    since: since[i]?.toISOString() ?? null,
    purchases: counts[i]?.[0]?.purchases ?? 0,
    buyers: counts[i]?.[0]?.buyers ?? 0,
    volume: (volumes[i] ?? []).map(({ mint, raw }) => {
      const token = FUNDING_TOKENS.find((t) => t.mint === mint);
      return {
        mint,
        symbol: token?.symbol ?? null,
        decimals: token?.decimals ?? null,
        raw,
      };
    }),
  }));
  return { state: "ok", asOf, source: USAGE_SOURCE, windows };
}

/** Registry facts and usage for one creator wallet. */
export async function getCreatorStats(
  db: CreatorsDb,
  wallet: string,
  options: { now?: Date } = {},
): Promise<CreatorStatsView> {
  const now = options.now ?? new Date();
  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.wallet, wallet));
  if (!creator)
    throw new AppError("NOT_FOUND", {
      publicMessage: "No creator uses this wallet.",
      detail: "stats-not-a-creator",
    });
  const [totals] = await db
    .select({
      published: sql<number>`count(*) filter (where ${baskets.status} = 'published')::int`,
      archived: sql<number>`count(*) filter (where ${baskets.status} = 'archived')::int`,
      versions: sql<number>`coalesce(sum(${baskets.version}) filter (where ${baskets.publishedAt} is not null), 0)::int`,
      last: sql<Date | null>`max(${baskets.publishedAt})`,
    })
    .from(baskets)
    .where(eq(baskets.creatorWallet, wallet));
  const iso = (value: Date | string | null | undefined) =>
    value ? new Date(value).toISOString() : null;
  return {
    wallet,
    displayName: creator.displayName,
    creatorSince: creator.createdAt.toISOString(),
    asOf: now.toISOString(),
    source: STATS_SOURCE,
    baskets: {
      published: totals?.published ?? 0,
      archived: totals?.archived ?? 0,
    },
    publishedVersions: totals?.versions ?? 0,
    lastPublishedAt: iso(totals?.last),
    usage: await receiptUsage(db, { creatorWallet: wallet }, now),
  };
}
