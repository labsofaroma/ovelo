import { z } from "zod";

/** Client contract of GET /api/v1/creators/dashboard (parsed; anything unexpected fails loudly). */
const volume = z.object({
  mint: z.string(),
  symbol: z.string().nullable(),
  decimals: z.number().int().nullable(),
  raw: z.string().regex(/^\d+$/),
});
const usage = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none"), asOf: z.string(), source: z.string() }),
  z.object({
    state: z.literal("ok"),
    asOf: z.string(),
    source: z.string(),
    windows: z.array(
      z.object({
        window: z.enum(["7d", "30d", "all"]),
        since: z.string().nullable(),
        purchases: z.number().int(),
        buyers: z.number().int(),
        volume: z.array(volume),
      }),
    ),
  }),
  z
    .object({ state: z.literal("unavailable"), reason: z.string() })
    .passthrough(),
]);

export const dashboardSchema = z.object({
  wallet: z.string(),
  displayName: z.string(),
  asOf: z.string(),
  source: z.string(),
  blinkTrackingSince: z.string(),
  baskets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      ticker: z.string(),
      status: z.enum(["draft", "published", "archived"]),
      version: z.number().int(),
      publishedAt: z.string().nullable(),
      usage,
      blink: z.array(
        z.object({
          window: z.enum(["7d", "30d", "all"]),
          tracked: z.number().int(),
          viaAction: z.number().int(),
          untracked: z.number().int(),
        }),
      ),
      versions: z.array(
        z.object({
          version: z.number().int(),
          name: z.string(),
          publishedAt: z.string(),
          allocations: z.array(
            z.object({
              mint: z.string(),
              symbol: z.string(),
              weightBps: z.number().int(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type DashboardData = z.infer<typeof dashboardSchema>;
export type DashboardBasket = DashboardData["baskets"][number];
