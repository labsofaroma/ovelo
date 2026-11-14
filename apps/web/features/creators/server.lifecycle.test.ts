import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creators } from "@/server/db/schema";
import type { CreatorsDb } from "./db";
import {
  archiveBasket,
  getCreatorBasket,
  listCreatorBaskets,
  listPublishedBaskets,
  publishBasket,
  saveDraft,
} from "./server";
import { getCreatorStats, STATS_SOURCE } from "./stats";
import { createTestDb } from "./test/db";
import {
  ALICE,
  BOB,
  content,
  failure,
  MINT_A,
  MINT_B,
  newId,
  NOW,
  registry,
  STRANGER,
} from "./test/fixtures";

let db: CreatorsDb;
let client: PGlite;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await db.insert(creators).values([
    { wallet: ALICE, displayName: "Alice", createdAt: NOW },
    { wallet: BOB, displayName: "Bob", createdAt: NOW },
  ]);
  // Alice: one basket published at NOW then republished (version 2), and one draft.
  const id = newId();
  const first = await publishBasket(db, {
    wallet: ALICE,
    basketId: id,
    content: content(),
    registry,
    now: NOW,
  });
  await publishBasket(db, {
    wallet: ALICE,
    basketId: id,
    content: content({
      ticker: first.ticker,
      allocations: [
        { mint: MINT_A, weightBps: 5000 },
        { mint: MINT_B, weightBps: 5000 },
      ],
    }),
    registry,
    now: new Date(NOW.getTime() + 60_000),
  });
  await saveDraft(db, {
    wallet: ALICE,
    basketId: newId(),
    content: { ...content(), allocations: [{ mint: MINT_A, weightBps: 1 }] },
    registry,
  });
});
afterAll(async () => {
  await client.close();
});

describe("archiving", () => {
  it("archives (no hard delete), is idempotent, owner-only, and blocks republishing", async () => {
    const id = newId();
    const body = content();
    await publishBasket(db, {
      wallet: ALICE,
      basketId: id,
      content: body,
      registry,
    });
    expect(
      await failure(() => archiveBasket(db, { wallet: BOB, basketId: id })),
    ).toBe("FORBIDDEN:wrong-owner");
    const archived = await archiveBasket(db, { wallet: ALICE, basketId: id });
    expect(archived.status).toBe("archived");
    expect(archived.allocations).toHaveLength(3);
    expect(
      (await archiveBasket(db, { wallet: ALICE, basketId: id })).status,
    ).toBe("archived");
    expect((await getCreatorBasket(db, id))?.status).toBe("archived");
    expect(
      await failure(() =>
        publishBasket(db, {
          wallet: ALICE,
          basketId: id,
          content: body,
          registry,
        }),
      ),
    ).toBe("CONFLICT:publish-archived");
    expect(
      await failure(() =>
        archiveBasket(db, { wallet: ALICE, basketId: newId() }),
      ),
    ).toBe("NOT_FOUND:archive-missing");
  });
});

describe("listing and stats", () => {
  it("lists published baskets newest first, and a creator's own by status", async () => {
    const id = newId();
    const when = new Date("2030-01-01T00:00:00.000Z");
    await publishBasket(db, {
      wallet: BOB,
      basketId: id,
      content: content(),
      registry,
      now: when,
    });
    const directory = await listPublishedBaskets(db, { limit: 500 });
    expect(directory[0]?.id).toBe(id);
    expect(directory.every((b) => b.status === "published")).toBe(true);
    const bobs = await listCreatorBaskets(db, BOB);
    expect(bobs.map((b) => b.id)).toContain(id);
    const all = await listCreatorBaskets(db, ALICE, {
      statuses: ["draft", "published", "archived"],
    });
    expect(new Set(all.map((b) => b.status))).toEqual(
      new Set(["draft", "published", "archived"]),
    );
    expect(await listPublishedBaskets(db, { limit: 1 })).toHaveLength(1);
  });

  it('reports only recorded facts, with source and as-of; no receipts is "none" (never 0)', async () => {
    const stats = await getCreatorStats(db, ALICE, { now: NOW });
    const published = await listCreatorBaskets(db, ALICE);
    const archived = await listCreatorBaskets(db, ALICE, {
      statuses: ["archived"],
    });
    expect(stats).toMatchObject({
      wallet: ALICE,
      displayName: "Alice",
      asOf: NOW.toISOString(),
      source: STATS_SOURCE,
      baskets: { published: published.length, archived: archived.length },
      usage: { state: "none", asOf: NOW.toISOString() },
    });
    // Versions count every publish, including the republished version 2 above.
    expect(stats.publishedVersions).toBe(
      [...published, ...archived].reduce((sum, b) => sum + b.version, 0),
    );
    const dates = [...published, ...archived]
      .map((b) => b.publishedAt ?? "")
      .sort();
    expect(stats.lastPublishedAt).toBe(dates.at(-1));
    expect(stats.usage).not.toHaveProperty("buyers");
    expect(stats.usage).not.toHaveProperty("windows");
  });

  it("a creator with nothing published has null dates, and a non-creator is NOT_FOUND", async () => {
    await db.insert(creators).values({
      wallet: "NewbieWa11et1111111111111111111111111111",
      displayName: "N",
    });
    const stats = await getCreatorStats(
      db,
      "NewbieWa11et1111111111111111111111111111",
    );
    expect(stats).toMatchObject({
      baskets: { published: 0, archived: 0 },
      publishedVersions: 0,
      lastPublishedAt: null,
    });
    expect(await failure(() => getCreatorStats(db, STRANGER))).toBe(
      "NOT_FOUND:stats-not-a-creator",
    );
  });
});
