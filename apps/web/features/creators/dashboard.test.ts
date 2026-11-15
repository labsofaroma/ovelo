import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { USDC_MINT } from "@/features/trade/schema";
import { resetEnvCacheForTests } from "@/server/env";
import { stubBaseEnv } from "@/server/test/base-env";
import { makeSigner } from "@/server/test/creator-fixtures";
import { sealSession } from "@/server/wallet-session";
import { markActionPurchase } from "./channels";
import { getDashboard, TRACKING_SINCE } from "./dashboard";
import { setCreatorDepsForTests } from "./http";
import { publishBasket } from "./server";
import { createTestDb } from "./test/db";
import { content, newId, registry } from "./test/fixtures";

/**
 * M11 Step 4: the dashboard shows only the session wallet's own baskets (another creator's basket
 * and a non-creator wallet get 403), with usage from confirmed receipts, a Blink share counted
 * only from TRACKING_SINCE, and the version history. A buyer count, never a buyer list.
 */
const route = await import("@/app/api/v1/creators/dashboard/route");
let t: Awaited<ReturnType<typeof createTestDb>>;
let alice: Awaited<ReturnType<typeof makeSigner>>;
let bob: Awaited<ReturnType<typeof makeSigner>>;
let stranger: Awaited<ReturnType<typeof makeSigner>>;
let alices: string;
let bobs: string;
const NOW = new Date("2026-11-20T12:00:00.000Z");
const DAY = 86_400_000;
let n = 0;

async function receipt(
  basketId: string,
  at: Date,
  request = `req-${++n}`,
  wallet = `Buyer${n}`,
) {
  const signature = `dash-sig-${++n}`;
  await t.client.query(
    `INSERT INTO receipts (signature, wallet, basket_id, kind, amount_in, mint_in, legs, status, created_at)
     VALUES ($1, $2, $3, 'basket', '2000000', $4, $5, 'confirmed', $6)`,
    [
      signature,
      wallet,
      basketId,
      USDC_MINT,
      JSON.stringify([{ requestId: request }]),
      at,
    ],
  );
  return signature;
}

beforeAll(async () => {
  t = await createTestDb();
  [alice, bob, stranger] = await Promise.all([
    makeSigner(),
    makeSigner(),
    makeSigner(),
  ]);
  for (const [wallet, name] of [
    [alice.wallet, "Alice"],
    [bob.wallet, "Bob"],
  ] as const) {
    const { rows } = await t.client.query<{ id: string }>(
      `INSERT INTO invites (code_hash, max_uses, uses, expires_at) VALUES ($1, 1, 1, now() + interval '1 day') RETURNING id`,
      [`dash-${name}`],
    );
    await t.client.query(
      `INSERT INTO creators (wallet, display_name, invite_id) VALUES ($1, $2, $3)`,
      [wallet, name, rows[0]!.id],
    );
  }
  alices = newId();
  bobs = newId();
  await publishBasket(t.db, {
    wallet: alice.wallet,
    basketId: alices,
    content: content(),
    registry,
    now: new Date("2026-10-01T00:00:00Z"),
  });
  await publishBasket(t.db, {
    wallet: bob.wallet,
    basketId: bobs,
    content: content(),
    registry,
    now: new Date("2026-10-01T00:00:00Z"),
  });
  // Before tracking: one buy. After: two buys, one through the Action.
  await receipt(alices, new Date(Date.parse(TRACKING_SINCE) - 3 * DAY));
  await receipt(alices, new Date(NOW.getTime() - 2 * DAY));
  await markActionPurchase(
    await receipt(alices, new Date(NOW.getTime() - DAY)),
    t.db,
  );
});
afterAll(async () => t.client.close());

describe("getDashboard", () => {
  it("lists only the wallet's own baskets, with usage, Blink share and versions", async () => {
    const view = await getDashboard(t.db, alice.wallet, { now: NOW });
    expect(view.baskets.map((b) => b.id)).toEqual([alices]);
    const [basket] = view.baskets;
    expect(basket!.usage).toMatchObject({ state: "ok" });
    const all =
      basket!.usage.state === "ok"
        ? basket!.usage.windows.find((w) => w.window === "all")
        : null;
    expect(all).toMatchObject({ purchases: 3, buyers: 3 });
    expect(basket!.blink.find((b) => b.window === "all")).toEqual({
      window: "all",
      tracked: 2,
      viaAction: 1,
      untracked: 1,
    });
    expect(basket!.blink.find((b) => b.window === "7d")).toEqual({
      window: "7d",
      tracked: 2,
      viaAction: 1,
      untracked: 0,
    });
    expect(basket!.versions).toEqual([expect.objectContaining({ version: 1 })]);
    expect(JSON.stringify(view)).not.toContain("Buyer");
  });

  it("another creator's basket, and a wallet that is not a creator, are refused (403)", async () => {
    await expect(
      getDashboard(t.db, alice.wallet, { now: NOW, basketId: bobs }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getDashboard(t.db, stranger.wallet, { now: NOW }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a basket with no buys says so (state none), never zero volume", async () => {
    const view = await getDashboard(t.db, bob.wallet, { now: NOW });
    expect(view.baskets[0]!.usage.state).toBe("none");
  });
});

describe("GET /api/v1/creators/dashboard", () => {
  beforeEach(() => {
    stubBaseEnv();
    resetEnvCacheForTests();
    setCreatorDepsForTests({ db: () => t.db, now: () => NOW });
  });
  const get = (query = "", authorization?: string) =>
    route.GET(
      new Request(
        `https://aroma.example/api/v1/creators/dashboard${query}`,
        authorization ? { headers: { authorization } } : {},
      ),
    );

  it("needs a creator-scope session", async () => {
    expect((await get()).status).toBe(401);
    expect(
      (await get("", `Bearer ${sealSession("notify", alice.wallet).token}`))
        .status,
    ).toBe(401);
  });

  it("serves the session wallet's own dashboard; another creator's basket is 403", async () => {
    const auth = `Bearer ${sealSession("creator", alice.wallet).token}`;
    const ok = await get("", auth);
    expect(ok.status).toBe(200);
    expect((await ok.json()).baskets).toHaveLength(1);
    const other = await get(`?basket=${bobs}`, auth);
    expect(other.status).toBe(403);
    expect(await other.json()).toEqual({
      code: "FORBIDDEN",
      message: "This basket belongs to another creator.",
    });
    expect(
      (await get("", `Bearer ${sealSession("creator", stranger.wallet).token}`))
        .status,
    ).toBe(403);
    vi.unstubAllEnvs();
  });
});
