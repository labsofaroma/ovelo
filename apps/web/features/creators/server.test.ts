import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creators } from "@/server/db/schema";
import type { CreatorsDb } from "./db";
import type { BasketDraft, BasketDraftInput } from "./schema";
import { getCreatorBasket, publishBasket, saveDraft } from "./server";
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
  ticker,
  UNLISTED,
} from "./test/fixtures";

let db: CreatorsDb;
let client: PGlite;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  await db.insert(creators).values([
    { wallet: ALICE, displayName: "Alice", createdAt: NOW },
    { wallet: BOB, displayName: "Bob", createdAt: NOW },
  ]);
});
afterAll(async () => {
  await client.close();
});

describe("drafts", () => {
  it("creates and updates a draft with partial weights; drafts stay private", async () => {
    const id = newId();
    const draft: BasketDraftInput = {
      name: " Draft ",
      ticker: "drft1",
      allocations: [{ mint: MINT_A, weightBps: 4000 }],
    };
    const saved = await saveDraft(db, {
      wallet: ALICE,
      basketId: id,
      content: draft as BasketDraft,
      registry,
    });
    expect(saved).toMatchObject({
      status: "draft",
      name: "Draft",
      ticker: "DRFT1",
      version: 1,
      publishedAt: null,
      allocations: [{ mint: MINT_A, symbol: "AAPLx", weightBps: 4000 }],
    });
    const updated = await saveDraft(db, {
      wallet: ALICE,
      basketId: id,
      content: {
        name: saved.name,
        ticker: saved.ticker,
        description: "",
        allocations: [
          { mint: MINT_A, weightBps: 4000 },
          { mint: MINT_B, weightBps: 1000 },
        ],
      },
      registry,
    });
    expect(updated.allocations).toHaveLength(2);
    expect(await getCreatorBasket(db, id)).toBeNull();
    expect(
      (await getCreatorBasket(db, id, { includeDrafts: true }))?.status,
    ).toBe("draft");
  });

  it("refuses non-creators, unregistered assets and someone else's draft", async () => {
    const id = newId();
    const draft = {
      name: "x",
      ticker: ticker(),
      description: "",
      allocations: [{ mint: MINT_A, weightBps: 1 }],
    };
    expect(
      await failure(() =>
        saveDraft(db, {
          wallet: STRANGER,
          basketId: id,
          content: draft,
          registry,
        }),
      ),
    ).toBe("FORBIDDEN:not-a-creator");
    expect(
      await failure(() =>
        saveDraft(db, {
          wallet: ALICE,
          basketId: id,
          content: {
            ...draft,
            allocations: [{ mint: UNLISTED, weightBps: 1 }],
          },
          registry,
        }),
      ),
    ).toBe("VALIDATION_FAILED:unregistered-mint");
    await saveDraft(db, {
      wallet: ALICE,
      basketId: id,
      content: draft,
      registry,
    });
    expect(
      await failure(() =>
        saveDraft(db, { wallet: BOB, basketId: id, content: draft, registry }),
      ),
    ).toBe("FORBIDDEN:wrong-owner");
  });
});

describe("publishing and versioning", () => {
  it("publishes a new basket as version 1, then a new version bumps it", async () => {
    const id = newId();
    const first = await publishBasket(db, {
      wallet: ALICE,
      basketId: id,
      content: content(),
      registry,
      now: NOW,
    });
    expect(first).toMatchObject({
      status: "published",
      version: 1,
      publishedAt: NOW.toISOString(),
      creatorName: "Alice",
    });
    expect(first.allocations.map((a) => a.symbol)).toEqual([
      "AAPLx",
      "NVDAx",
      "TSLAx",
    ]);
    const later = new Date(NOW.getTime() + 60_000);
    const second = await publishBasket(db, {
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
      now: later,
    });
    expect(second).toMatchObject({
      version: 2,
      publishedAt: later.toISOString(),
    });
    expect(second.allocations).toHaveLength(2);
  });

  it("publishing a draft keeps version 1; published baskets cannot go back to drafts", async () => {
    const id = newId();
    const body = content();
    await saveDraft(db, {
      wallet: ALICE,
      basketId: id,
      content: body,
      registry,
    });
    const published = await publishBasket(db, {
      wallet: ALICE,
      basketId: id,
      content: body,
      registry,
      now: NOW,
    });
    expect(published.version).toBe(1);
    expect(
      await failure(() =>
        saveDraft(db, { wallet: ALICE, basketId: id, content: body, registry }),
      ),
    ).toBe("CONFLICT:draft-of-published");
  });

  it("refuses weights that do not sum to 10,000, before and at the database", async () => {
    const bad = content({
      allocations: [
        { mint: MINT_A, weightBps: 5000 },
        { mint: MINT_B, weightBps: 4999 },
      ],
    });
    expect(
      await failure(() =>
        publishBasket(db, {
          wallet: ALICE,
          basketId: newId(),
          content: bad,
          registry,
        }),
      ),
    ).toBe("ZodError");
    // The deferred trigger is the last line of defence: flip a draft to published directly.
    const id = newId();
    await saveDraft(db, {
      wallet: ALICE,
      basketId: id,
      content: { ...bad },
      registry,
    });
    await expect(
      client.query(
        `UPDATE baskets SET status = 'published', published_at = now() WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/basket_weights_sum_10000|summing to 9999/);
  });

  it("refuses a single-asset basket (lib/sdk minimum) and duplicate mints", async () => {
    expect(
      await failure(() =>
        publishBasket(db, {
          wallet: ALICE,
          basketId: newId(),
          content: content({
            allocations: [{ mint: MINT_A, weightBps: 10_000 }],
          }),
          registry,
        }),
      ),
    ).toBe("ZodError");
    expect(
      await failure(() =>
        publishBasket(db, {
          wallet: ALICE,
          basketId: newId(),
          content: content({
            allocations: [
              { mint: MINT_A, weightBps: 5000 },
              { mint: MINT_A, weightBps: 5000 },
            ],
          }),
          registry,
        }),
      ),
    ).toBe("ZodError");
  });

  it("maps a taken ticker to CONFLICT", async () => {
    const taken = content();
    await publishBasket(db, {
      wallet: ALICE,
      basketId: newId(),
      content: taken,
      registry,
    });
    expect(
      await failure(() =>
        publishBasket(db, {
          wallet: BOB,
          basketId: newId(),
          content: { ...taken },
          registry,
        }),
      ),
    ).toMatch(/^CONFLICT:unique:.*ticker/);
  });

  it("only the owner can publish a new version", async () => {
    const id = newId();
    const body = content();
    await publishBasket(db, {
      wallet: ALICE,
      basketId: id,
      content: body,
      registry,
    });
    expect(
      await failure(() =>
        publishBasket(db, {
          wallet: BOB,
          basketId: id,
          content: body,
          registry,
        }),
      ),
    ).toBe("FORBIDDEN:wrong-owner");
  });
});
