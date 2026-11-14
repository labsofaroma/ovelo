import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { toMarketsView } from "@/features/markets/normalize";
import { asset, snapshot } from "@/features/test/fixtures";
import {
  getCreatorBasketPage,
  lookupCreatorBasket,
  toSummary,
} from "./basket-page";
import { loadEditableBasket } from "./editable";
import { archiveBasket, publishBasket, saveDraft } from "./server";
import { createTestDb } from "./test/db";
import {
  ALICE,
  content,
  MINT_A,
  MINT_B,
  MINT_C,
  newId,
  NOW,
  registry,
} from "./test/fixtures";

/** `/v1/basket/[id]` and `/v1/basket/new?from=` loaders for creator baskets (M5b B2). */
const markets = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/features/markets/server", () => ({
  getMarkets: async () => markets.value,
}));

const view = toMarketsView(
  snapshot({
    assets: [
      asset({ mint: MINT_A, symbol: "AAPLx" }),
      asset({
        mint: MINT_B,
        symbol: "NVDAx",
        priceUsd: null,
        priceSource: null,
        priceObservedAt: null,
      }),
    ],
  }),
);

let t: Awaited<ReturnType<typeof createTestDb>>;
const db = () => t.db;
const unreachable = () => {
  throw Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
};

beforeAll(async () => {
  t = await createTestDb();
  await t.client.query(
    `INSERT INTO invites (code_hash, max_uses, uses, expires_at) VALUES ('h', 1, 1, now() + interval '1 day')`,
  );
  const { rows } = await t.client.query<{ id: string }>(
    `SELECT id FROM invites LIMIT 1`,
  );
  await t.client.query(
    `INSERT INTO creators (wallet, display_name, invite_id) VALUES ($1, 'Alice', $2)`,
    [ALICE, rows[0]!.id],
  );
});
afterAll(async () => {
  await t.client.close();
});
beforeEach(() => {
  markets.value = { state: "ok", data: view };
});

const publish = async (id = newId()) => {
  await publishBasket(t.db, {
    wallet: ALICE,
    basketId: id,
    content: content(),
    registry,
    now: NOW,
  });
  return id;
};

describe("toSummary", () => {
  it("matches signed weights to the catalog; unlisted and unpriced are reported, never invented", async () => {
    const id = await publish();
    const basket = await lookupCreatorBasket(id, db);
    if (!basket || basket === "unavailable") throw new Error("missing");
    const { basket: summary, rows } = toSummary(basket, view);
    expect(summary).toMatchObject({
      id,
      category: "creator",
      available: false,
      missingSymbols: ["TSLAx"],
      unpricedSymbols: ["NVDAx"],
    });
    expect(summary.members.map((m) => m.mint)).toEqual([MINT_A, MINT_B]);
    expect(rows.map((r) => r.mint)).toEqual([MINT_A, MINT_B]);
    expect(basket.allocations.map((a) => a.mint)).toContain(MINT_C);
  });
});

describe("getCreatorBasketPage", () => {
  it("ok with the catalog; catalog outage keeps the signed weights; registry outage is unavailable", async () => {
    const id = await publish();
    expect((await getCreatorBasketPage(id, db)).state).toBe("ok");
    markets.value = {
      state: "unavailable",
      error: { code: "UPSTREAM_UNAVAILABLE", message: "down" },
    };
    const outage = await getCreatorBasketPage(id, db);
    expect(outage.state).toBe("catalog-unavailable");
    expect((await getCreatorBasketPage(id, unreachable)).state).toBe(
      "unavailable",
    );
  });

  it("drafts and unknown ids are not found; archived baskets are shown", async () => {
    const draft = newId();
    await saveDraft(t.db, {
      wallet: ALICE,
      basketId: draft,
      content: content(),
      registry,
    });
    expect((await getCreatorBasketPage(draft, db)).state).toBe("not-found");
    expect((await getCreatorBasketPage(newId(), db)).state).toBe("not-found");
    const archived = await publish();
    await archiveBasket(t.db, { wallet: ALICE, basketId: archived });
    const page = await getCreatorBasketPage(archived, db);
    expect(page.state === "ok" && page.creator.status).toBe("archived");
  });
});

describe("loadEditableBasket", () => {
  it("prefills a published basket, refuses archived, unknown and malformed ids, and survives an outage", async () => {
    const id = await publish();
    const ok = await loadEditableBasket(id, db);
    expect(ok.state === "ok" && ok.initial).toMatchObject({
      basketId: id,
      version: 1,
    });
    expect(await loadEditableBasket(null, db)).toEqual({ state: "none" });
    expect((await loadEditableBasket("not-a-uuid", db)).state).toBe(
      "unavailable",
    );
    expect((await loadEditableBasket(newId(), db)).state).toBe("unavailable");
    await archiveBasket(t.db, { wallet: ALICE, basketId: id });
    const archived = await loadEditableBasket(id, db);
    expect(archived.state === "unavailable" && archived.reason).toMatch(
      /Archived/,
    );
    expect((await loadEditableBasket(newId(), unreachable)).state).toBe(
      "unavailable",
    );
  });
});
