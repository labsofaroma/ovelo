import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { validateProgrammableBasket } from "@/lib/sdk/baskets/custom";
import {
  basketAllocations,
  baskets,
  basketVersions,
  creators,
} from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { type CreatorsDb, mapDbError } from "./db";
import {
  type AllocationInput,
  type BasketDraft,
  basketDraftSchema,
  type BasketPublish,
  basketPublishSchema,
  type CreatorBasketView,
} from "./schema";

/**
 * Creator baskets on Postgres (REWRITE-PLAN §5.2: replaces the prototype's creator-store.ts, which
 * used Redis as a database, and the reconciliation helper, which only batched RPC reads for
 * subscription stats that are not part of v1 creators).
 *
 * Rules kept from the prototype: only invited creators publish; weights are positive integer bps
 * summing to 10,000 (validated here with lib/sdk, and again by the deferred trigger at COMMIT);
 * published content is immutable (changing it publishes a new version); no self-reported metrics.
 * New: ownership (only the creator wallet changes its baskets), drafts, archive instead of delete.
 *
 * Every function takes the database handle, so routes pass `getDb()` and tests pass PGlite.
 * Callers have already verified the wallet's signature (server/auth/creator.ts).
 */

/** Which mints may be used, and their catalog symbol. Built from the market snapshot by routes. */
export type AssetRegistry = ReadonlyMap<string, { symbol: string }>;

const CATEGORY = "custom";

async function requireCreator(db: CreatorsDb, wallet: string): Promise<void> {
  const rows = await db
    .select({ wallet: creators.wallet })
    .from(creators)
    .where(eq(creators.wallet, wallet));
  if (!rows.length)
    throw new AppError("FORBIDDEN", {
      publicMessage: "Only invited creators can save or publish baskets.",
      detail: "not-a-creator",
    });
}

function resolveSymbols(
  allocations: readonly AllocationInput[],
  registry: AssetRegistry,
) {
  return allocations.map((allocation) => {
    const asset = registry.get(allocation.mint);
    if (!asset)
      throw new AppError("VALIDATION_FAILED", {
        publicMessage:
          "One of the assets is not registered or not tradable right now. Choose it again from the list.",
        detail: "unregistered-mint",
      });
    return { ...allocation, symbol: asset.symbol };
  });
}

type Tx = Parameters<Parameters<CreatorsDb["transaction"]>[0]>[0];

async function lockOwned(tx: Tx, id: string, wallet: string) {
  const [row] = await tx
    .select()
    .from(baskets)
    .where(eq(baskets.id, id))
    .for("update");
  if (row && row.creatorWallet !== wallet)
    throw new AppError("FORBIDDEN", {
      publicMessage: "Only the creator who owns this basket can change it.",
      detail: "wrong-owner",
    });
  return row;
}

async function replaceAllocations(
  tx: Tx,
  id: string,
  allocations: ReturnType<typeof resolveSymbols>,
) {
  await tx.delete(basketAllocations).where(eq(basketAllocations.basketId, id));
  await tx.insert(basketAllocations).values(
    allocations.map((a) => ({
      basketId: id,
      mint: a.mint,
      symbol: a.symbol,
      weightBps: a.weightBps,
    })),
  );
}

/** Create or update a draft. Published and archived baskets cannot be edited as drafts. */
export async function saveDraft(
  db: CreatorsDb,
  input: {
    wallet: string;
    basketId: string;
    content: BasketDraft;
    registry: AssetRegistry;
  },
): Promise<CreatorBasketView> {
  const content = basketDraftSchema.parse(input.content);
  await requireCreator(db, input.wallet);
  const allocations = resolveSymbols(content.allocations, input.registry);
  try {
    await db.transaction(async (tx) => {
      const row = await lockOwned(tx, input.basketId, input.wallet);
      if (row && row.status !== "draft")
        throw new AppError("CONFLICT", {
          publicMessage:
            "Published baskets cannot be edited. Publish a new version instead.",
          detail: `draft-of-${row.status}`,
        });
      const fields = {
        name: content.name,
        ticker: content.ticker,
        description: content.description,
      };
      if (row)
        await tx
          .update(baskets)
          .set(fields)
          .where(eq(baskets.id, input.basketId));
      else
        await tx.insert(baskets).values({
          id: input.basketId,
          creatorWallet: input.wallet,
          category: CATEGORY,
          status: "draft",
          ...fields,
        });
      await replaceAllocations(tx, input.basketId, allocations);
    });
  } catch (error) {
    mapDbError(error);
  }
  return mustGet(db, input.basketId);
}

/**
 * Publish a draft, a new basket, or a new version of a published basket. Versioning: the first
 * publish is version 1; each later publish of the same basket increments `version` and replaces
 * the allocations. Every published version is also kept in `basket_versions` (insert-only).
 * Archived baskets cannot be republished.
 */
export async function publishBasket(
  db: CreatorsDb,
  input: {
    wallet: string;
    basketId: string;
    content: BasketPublish;
    registry: AssetRegistry;
    now?: Date;
  },
): Promise<CreatorBasketView> {
  const content = basketPublishSchema.parse(input.content);
  await requireCreator(db, input.wallet);
  const allocations = resolveSymbols(content.allocations, input.registry);
  const now = input.now ?? new Date();
  try {
    // The lib/sdk rules (2–12 legs, unique mints, positive integer bps, exact 10,000).
    validateProgrammableBasket({
      id: input.basketId,
      name: content.name,
      ticker: content.ticker,
      description: content.description,
      category: CATEGORY,
      allocations,
      isCustom: true,
    });
  } catch {
    throw new AppError("VALIDATION_FAILED", {
      publicMessage:
        "The basket was refused: 2 to 12 unique assets with weights summing to exactly 100%.",
      detail: "sdk-validation",
    });
  }
  try {
    await db.transaction(async (tx) => {
      const row = await lockOwned(tx, input.basketId, input.wallet);
      if (row?.status === "archived")
        throw new AppError("CONFLICT", {
          publicMessage: "Archived baskets cannot be published again.",
          detail: "publish-archived",
        });
      const fields = {
        name: content.name,
        ticker: content.ticker,
        description: content.description,
        status: "published" as const,
        publishedAt: now,
      };
      const version = row
        ? row.publishedAt
          ? row.version + 1
          : row.version
        : 1;
      if (row)
        await tx
          .update(baskets)
          .set({ ...fields, version })
          .where(eq(baskets.id, input.basketId));
      else
        await tx.insert(baskets).values({
          id: input.basketId,
          creatorWallet: input.wallet,
          category: CATEGORY,
          version,
          createdAt: now,
          ...fields,
        });
      await replaceAllocations(tx, input.basketId, allocations);
      // Insert-only history: receipts point at (basket, version) for the exact weights bought.
      await tx.insert(basketVersions).values({
        basketId: input.basketId,
        version,
        name: content.name,
        ticker: content.ticker,
        allocations: allocations.map(({ mint, symbol, weightBps }) => ({
          mint,
          symbol,
          weightBps,
        })),
        publishedAt: now,
      });
    });
  } catch (error) {
    mapDbError(error);
  }
  return mustGet(db, input.basketId);
}

/** Archive (never hard-delete: receipts may reference the basket). Idempotent for the owner. */
export async function archiveBasket(
  db: CreatorsDb,
  input: { wallet: string; basketId: string },
): Promise<CreatorBasketView> {
  await db.transaction(async (tx) => {
    const row = await lockOwned(tx, input.basketId, input.wallet);
    if (!row) throw new AppError("NOT_FOUND", { detail: "archive-missing" });
    if (row.status !== "archived")
      await tx
        .update(baskets)
        .set({ status: "archived" })
        .where(eq(baskets.id, input.basketId));
  });
  return mustGet(db, input.basketId);
}

/* ------------------------------------------------------------------ reads */

type BasketRow = typeof baskets.$inferSelect & { creatorName: string | null };

async function withAllocations(
  db: CreatorsDb,
  rows: BasketRow[],
): Promise<CreatorBasketView[]> {
  if (!rows.length) return [];
  const legs = await db
    .select()
    .from(basketAllocations)
    .where(
      inArray(
        basketAllocations.basketId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(desc(basketAllocations.weightBps), asc(basketAllocations.symbol));
  return rows.map((row) => ({
    id: row.id,
    creatorWallet: row.creatorWallet ?? "",
    creatorName: row.creatorName,
    name: row.name,
    ticker: row.ticker,
    category: row.category,
    description: row.description,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    allocations: legs
      .filter((leg) => leg.basketId === row.id)
      .map(({ mint, symbol, weightBps }) => ({ mint, symbol, weightBps })),
  }));
}

const basketColumns = {
  id: baskets.id,
  creatorWallet: baskets.creatorWallet,
  name: baskets.name,
  ticker: baskets.ticker,
  category: baskets.category,
  description: baskets.description,
  status: baskets.status,
  version: baskets.version,
  createdAt: baskets.createdAt,
  publishedAt: baskets.publishedAt,
  creatorName: creators.displayName,
};

/** One creator basket. Drafts are private: only returned when `includeDrafts` is set. */
export async function getCreatorBasket(
  db: CreatorsDb,
  id: string,
  options: { includeDrafts?: boolean } = {},
): Promise<CreatorBasketView | null> {
  const rows = await db
    .select(basketColumns)
    .from(baskets)
    .innerJoin(creators, eq(creators.wallet, baskets.creatorWallet))
    .where(eq(baskets.id, id));
  const [view] = await withAllocations(db, rows);
  if (!view || (view.status === "draft" && !options.includeDrafts)) return null;
  return view;
}

async function mustGet(db: CreatorsDb, id: string) {
  const view = await getCreatorBasket(db, id, { includeDrafts: true });
  if (!view) throw new AppError("INTERNAL", { detail: "basket vanished" });
  return view;
}

/** A creator's baskets, newest first. Public callers get published ones only. */
export async function listCreatorBaskets(
  db: CreatorsDb,
  wallet: string,
  options: { statuses?: readonly CreatorBasketView["status"][] } = {},
): Promise<CreatorBasketView[]> {
  const statuses = options.statuses ?? ["published"];
  const rows = await db
    .select(basketColumns)
    .from(baskets)
    .innerJoin(creators, eq(creators.wallet, baskets.creatorWallet))
    .where(
      and(eq(baskets.creatorWallet, wallet), inArray(baskets.status, statuses)),
    )
    .orderBy(desc(baskets.createdAt), asc(baskets.id));
  return withAllocations(db, rows);
}

/** The public directory: published creator baskets, most recently published first. */
export async function listPublishedBaskets(
  db: CreatorsDb,
  options: { limit?: number } = {},
): Promise<CreatorBasketView[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = await db
    .select(basketColumns)
    .from(baskets)
    .innerJoin(creators, eq(creators.wallet, baskets.creatorWallet))
    .where(eq(baskets.status, "published"))
    .orderBy(desc(baskets.publishedAt), asc(baskets.id))
    .limit(limit);
  return withAllocations(db, rows);
}
