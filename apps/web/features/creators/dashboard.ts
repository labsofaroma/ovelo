import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  basketVersions,
  creators,
  purchaseChannels,
  receipts,
} from "@/server/db/schema";
import { AppError } from "@/server/errors";
import type { CreatorsDb } from "./db";
import { feeSettings } from "@/server/env.fees";
import { ledgerSummary } from "./fee-share";
import { listCreatorBaskets } from "./server";
import { receiptUsage, USAGE_SOURCE, USAGE_WINDOWS } from "./stats";

/**
 * The creator dashboard (M11 Step 4): for the session's own wallet only, every basket it created
 * (drafts, published, archived) with its usage from confirmed receipts (stats.ts: buys, unique
 * buyer COUNT, volume per funding mint) for 7 d, 30 d and all time, the share of those buys made
 * through the Solana Action (Blink), and its version history. Never a buyer list.
 *
 * Blink share is counted only from TRACKING_SINCE (purchase_channels, migration 0008): buys before
 * that date are "not recorded", never assumed to be app buys.
 */
export const TRACKING_SINCE = "2026-11-15T00:00:00.000Z";
const DAY_MS = 86_400_000;

export type BlinkShare = {
  window: (typeof USAGE_WINDOWS)[number]["window"];
  /** Confirmed buys in the window made on or after TRACKING_SINCE. */
  tracked: number;
  viaAction: number;
  /** Confirmed buys in the window made before TRACKING_SINCE (channel not recorded). */
  untracked: number;
};

const order = sql`coalesce(${receipts.legs}->0->>'requestId', ${receipts.signature})`;

async function blinkShare(
  db: CreatorsDb,
  basketId: string,
  now: Date,
): Promise<BlinkShare[]> {
  return Promise.all(
    USAGE_WINDOWS.map(async (w) => {
      const since =
        w.days === null ? null : new Date(now.getTime() - w.days * DAY_MS);
      const [row] = await db
        .select({
          tracked: sql<number>`count(distinct ${order}) filter (where ${receipts.createdAt} >= ${TRACKING_SINCE}::timestamptz)::int`,
          untracked: sql<number>`count(distinct ${order}) filter (where ${receipts.createdAt} < ${TRACKING_SINCE}::timestamptz)::int`,
          viaAction: sql<number>`count(distinct ${order}) filter (where ${purchaseChannels.channel} = 'action')::int`,
        })
        .from(receipts)
        .leftJoin(
          purchaseChannels,
          eq(purchaseChannels.signature, receipts.signature),
        )
        .where(
          and(
            eq(receipts.basketId, basketId),
            eq(receipts.status, "confirmed"),
            eq(receipts.kind, "basket"),
            sql`${receipts.createdAt} <= ${now.toISOString()}::timestamptz`,
            since
              ? sql`${receipts.createdAt} >= ${since.toISOString()}::timestamptz`
              : sql`true`,
          ),
        );
      return {
        window: w.window,
        tracked: row?.tracked ?? 0,
        viaAction: row?.viaAction ?? 0,
        untracked: row?.untracked ?? 0,
      };
    }),
  );
}

export async function getDashboard(
  db: CreatorsDb,
  wallet: string,
  options: { now?: Date; basketId?: string } = {},
) {
  const now = options.now ?? new Date();
  const [creator] = await db
    .select({ displayName: creators.displayName })
    .from(creators)
    .where(eq(creators.wallet, wallet));
  if (!creator)
    throw new AppError("FORBIDDEN", {
      publicMessage:
        "This wallet is not a creator, so it has no creator dashboard.",
      detail: "dashboard: not a creator",
    });
  const own = await listCreatorBaskets(db, wallet, {
    statuses: ["draft", "published", "archived"],
  });
  if (options.basketId && !own.some((b) => b.id === options.basketId))
    throw new AppError("FORBIDDEN", {
      publicMessage: "This basket belongs to another creator.",
      detail: "dashboard: not the owner",
    });
  const chosen = options.basketId
    ? own.filter((b) => b.id === options.basketId)
    : own;
  const baskets = await Promise.all(
    chosen.map(async (basket) => {
      const versions = await db
        .select({
          version: basketVersions.version,
          name: basketVersions.name,
          allocations: basketVersions.allocations,
          publishedAt: basketVersions.publishedAt,
        })
        .from(basketVersions)
        .where(eq(basketVersions.basketId, basket.id))
        .orderBy(desc(basketVersions.version), asc(basketVersions.basketId));
      return {
        id: basket.id,
        name: basket.name,
        ticker: basket.ticker,
        status: basket.status,
        version: basket.version,
        publishedAt: basket.publishedAt,
        usage: await receiptUsage(db, { basketId: basket.id }, now),
        blink: await blinkShare(db, basket.id, now),
        // Accounting only (M11 5a): off while no platform fee is charged.
        feeShare: {
          state:
            feeSettings(process.env).platformFeeBps === 0
              ? ("off" as const)
              : ("on" as const),
          ...(await ledgerSummary(db, wallet, basket.id)),
        },
        versions: versions.map((v) => ({
          version: v.version,
          name: v.name,
          publishedAt: v.publishedAt.toISOString(),
          allocations: v.allocations,
        })),
      };
    }),
  );
  return {
    wallet,
    displayName: creator.displayName,
    asOf: now.toISOString(),
    source: USAGE_SOURCE,
    blinkTrackingSince: TRACKING_SINCE,
    baskets,
  };
}
export type DashboardView = Awaited<ReturnType<typeof getDashboard>>;
