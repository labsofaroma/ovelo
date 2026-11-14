import { z } from "zod";

/**
 * Creator basket shapes shared by the API and the builder UI (REWRITE-PLAN §2.3: one zod schema
 * per concern). Client-safe: no server imports. Weights are integer basis points; a published
 * basket's weights sum to exactly 10,000 (also enforced by the database trigger at COMMIT).
 */

export const BPS_TOTAL = 10_000;
/** Same bounds as lib/sdk/baskets/custom (MIN/MAX_CUSTOM_BASKET_LEGS). */
export const MIN_LEGS = 2;
export const MAX_LEGS = 12;
export const NAME_MAX = 50;
export const DESCRIPTION_MAX = 500;

export const mintSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, {
  message: "must be a token mint address",
});

export const basketIdSchema = z.uuid();

export const allocationInputSchema = z.strictObject({
  mint: mintSchema,
  weightBps: z.number().int().min(1).max(BPS_TOTAL),
});
export type AllocationInput = z.infer<typeof allocationInputSchema>;

const uniqueMints = (items: readonly AllocationInput[]) =>
  new Set(items.map((item) => item.mint)).size === items.length;

export const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,15}$/, { message: "must be 2 to 15 letters or digits" });

const contentFields = {
  name: z.string().trim().min(1).max(NAME_MAX),
  ticker: tickerSchema,
  description: z.string().trim().max(DESCRIPTION_MAX).default(""),
};

/** A draft may be incomplete: any number of legs up to the maximum, weights not yet at 100%. */
export const basketDraftSchema = z.strictObject({
  ...contentFields,
  allocations: z
    .array(allocationInputSchema)
    .min(1)
    .max(MAX_LEGS)
    .refine(uniqueMints, { message: "each asset may appear once" }),
});
export type BasketDraftInput = z.input<typeof basketDraftSchema>;
export type BasketDraft = z.output<typeof basketDraftSchema>;

export const sumBps = (items: readonly { weightBps: number }[]): number =>
  items.reduce((sum, item) => sum + item.weightBps, 0);

/** What may be published: 2–12 unique assets whose weights sum to exactly 10,000 bps. */
export const basketPublishSchema = z.strictObject({
  ...contentFields,
  allocations: z
    .array(allocationInputSchema)
    .min(MIN_LEGS)
    .max(MAX_LEGS)
    .refine(uniqueMints, { message: "each asset may appear once" })
    .refine((items) => sumBps(items) === BPS_TOTAL, {
      message: "weights must sum to exactly 10,000 basis points",
    }),
});
export type BasketPublish = z.output<typeof basketPublishSchema>;

export const creatorProfileSchema = z.strictObject({
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[^\p{Cc}\p{Cf}]+$/u, { message: "must be plain text" }),
  /** An https profile link (X, Farcaster, a website). Optional. */
  social: z
    .url({ protocol: /^https$/ })
    .max(200)
    .optional(),
});
export type CreatorProfile = z.infer<typeof creatorProfileSchema>;

export const BASKET_STATUSES = ["draft", "published", "archived"] as const;

/* ------------------------------------------------------------------ views */

export type CreatorBasketView = {
  id: string;
  creatorWallet: string;
  creatorName: string | null;
  name: string;
  ticker: string;
  category: string;
  description: string;
  status: (typeof BASKET_STATUSES)[number];
  version: number;
  createdAt: string;
  publishedAt: string | null;
  /** Ordered by weight, largest first. Symbols come from the asset registry at save time. */
  allocations: { mint: string; symbol: string; weightBps: number }[];
};

/** One usage window from confirmed receipts. Volume is raw integer units per funding mint. */
export type UsageWindow = {
  window: "7d" | "30d" | "all";
  /** Start of the window (null: since the first purchase). */
  since: string | null;
  purchases: number;
  buyers: number;
  volume: {
    mint: string;
    symbol: string | null;
    decimals: number | null;
    raw: string;
  }[];
};

/**
 * Purchases through creator baskets, from CONFIRMED receipts only (M5b B5). `none` means no
 * confirmed purchase was ever recorded: shown as "no purchases yet", never as 0 volume.
 * `unavailable` means it could not be measured (for example, the database is down).
 */
export type UsageView =
  | { state: "ok"; asOf: string; source: string; windows: UsageWindow[] }
  | { state: "none"; asOf: string; source: string }
  | { state: "unavailable"; reason: string };

/** Only what Aroma actually records (PRODUCT.md: never invent creator metrics). */
export type CreatorStatsView = {
  wallet: string;
  displayName: string;
  creatorSince: string;
  asOf: string;
  source: string;
  baskets: { published: number; archived: number };
  /** Every publish of every basket, including republished versions. */
  publishedVersions: number;
  /**
   * When this creator last published (any basket, any version). There is no "first published"
   * date: a new version overwrites `published_at` and earlier versions are not kept yet.
   */
  lastPublishedAt: string | null;
  usage: UsageView;
};

/** "12.34%" from 1234 bps, with integer arithmetic only. */
export function formatBpsPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  return `${whole}.${String(Math.abs(bps % 100)).padStart(2, "0")}%`;
}

/**
 * Human-readable lines for the wallet prompt. Derived only from the content (never from the
 * changing market catalog), so verification rebuilds exactly the message that was signed.
 */
export function describeBasket(content: {
  name: string;
  ticker: string;
  allocations: readonly AllocationInput[];
}): string[] {
  return [
    `Basket: ${content.name} (${content.ticker})`,
    ...content.allocations.map(
      (a) => `Weight ${formatBpsPercent(a.weightBps)}: ${a.mint}`,
    ),
  ];
}
