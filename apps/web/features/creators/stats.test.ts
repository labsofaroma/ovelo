import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOL_MINT, USDC_MINT } from "@/features/trade/schema";
import { publishBasket } from "./server";
import { getCreatorStats, receiptUsage, USAGE_SOURCE } from "./stats";
import { createTestDb } from "./test/db";
import { ALICE, BOB, content, newId, NOW, registry } from "./test/fixtures";

/**
 * M5b B5: creator usage from receipts. Confirmed only; one purchase per order; raw volume per
 * funding mint; defined windows with an as-of time; nothing confirmed is "none", never 0.
 */
let t: Awaited<ReturnType<typeof createTestDb>>;
let alices: string;
let alices2: string;
let bobs: string;
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
let n = 0;

async function receipt(input: {
  basketId: string | null;
  wallet?: string;
  status?: "pending" | "confirmed" | "failed";
  amount?: string;
  mint?: string;
  /** Order time (created_at). */
  at?: Date;
  requestId?: string;
}) {
  n += 1;
  await t.client.query(
    `INSERT INTO receipts (signature, wallet, basket_id, kind, amount_in, mint_in, legs, status, block_time, created_at)
     VALUES ($1, $2, $3, 'basket', $4, $5, $6, $7, $8, $9)`,
    [
      `sig-${n}`,
      input.wallet ?? "Buyer1111111111111111111111111111111111111",
      input.basketId,
      input.amount ?? "1000000",
      input.mint ?? USDC_MINT,
      JSON.stringify([{ requestId: input.requestId ?? `req-${n}` }]),
      input.status ?? "confirmed",
      // Block time deliberately skewed: windows use the order time (created_at), not it.
      new Date(NOW.getTime() + 5 * 3_600_000),
      input.at === undefined ? ago(1) : input.at,
    ],
  );
}

beforeAll(async () => {
  t = await createTestDb();
  for (const [wallet, name] of [
    [ALICE, "Alice"],
    [BOB, "Bob"],
  ] as const) {
    const { rows } = await t.client.query<{ id: string }>(
      `INSERT INTO invites (code_hash, max_uses, uses, expires_at) VALUES ($1, 1, 1, now() + interval '1 day') RETURNING id`,
      [`h-${name}`],
    );
    await t.client.query(
      `INSERT INTO creators (wallet, display_name, invite_id) VALUES ($1, $2, $3)`,
      [wallet, name, rows[0]!.id],
    );
  }
  const publish = async (wallet: string) => {
    const id = newId();
    await publishBasket(t.db, {
      wallet,
      basketId: id,
      content: content(),
      registry,
      now: ago(60),
    });
    return id;
  };
  alices = await publish(ALICE);
  alices2 = await publish(ALICE);
  bobs = await publish(BOB);
});
afterAll(async () => {
  await t.client.close();
});

describe("receiptUsage", () => {
  it("no confirmed receipt is 'none' with an as-of and source, never zero volume", async () => {
    await receipt({ basketId: alices, status: "pending" });
    await receipt({ basketId: alices, status: "failed" });
    const usage = await receiptUsage(t.db, { basketId: alices }, NOW);
    expect(usage).toEqual({
      state: "none",
      asOf: NOW.toISOString(),
      source: USAGE_SOURCE,
    });
  });

  it("counts confirmed orders, buyers and raw volume per mint over 7d, 30d and all time", async () => {
    // 2 days ago: buyer A, a 2-transaction bundle (one order), 1.5 + 0.5 USDC.
    await receipt({
      basketId: alices,
      wallet: "BuyerA",
      amount: "1500000",
      at: ago(2),
      requestId: "bundle",
    });
    await receipt({
      basketId: alices,
      wallet: "BuyerA",
      amount: "500000",
      at: ago(2),
      requestId: "bundle",
    });
    // 10 days ago: buyer B, 0.25 SOL.
    await receipt({
      basketId: alices,
      wallet: "BuyerB",
      amount: "250000000",
      mint: SOL_MINT,
      at: ago(10),
    });
    // 45 days ago: buyer A again, 3 USDC.
    await receipt({
      basketId: alices,
      wallet: "BuyerA",
      amount: "3000000",
      at: ago(45),
    });
    // Never counted: pending, failed, someone else's basket, a curated (null) basket.
    await receipt({
      basketId: alices,
      wallet: "BuyerC",
      status: "pending",
      amount: "9",
    });
    await receipt({
      basketId: alices,
      wallet: "BuyerC",
      status: "failed",
      amount: "9",
    });
    await receipt({ basketId: bobs, wallet: "BuyerC", amount: "9" });
    await receipt({ basketId: null, wallet: "BuyerC", amount: "9" });

    const usage = await receiptUsage(t.db, { basketId: alices }, NOW);
    expect(usage.state).toBe("ok");
    if (usage.state !== "ok") return;
    expect(usage.asOf).toBe(NOW.toISOString());
    const [d7, d30, all] = usage.windows;
    expect(d7).toEqual({
      window: "7d",
      since: ago(7).toISOString(),
      purchases: 1,
      buyers: 1,
      volume: [
        { mint: USDC_MINT, symbol: "USDC", decimals: 6, raw: "2000000" },
      ],
    });
    expect(d30).toMatchObject({ window: "30d", purchases: 2, buyers: 2 });
    // Sorted by mint (USDC "EPj…" before SOL "So1…"); never added across mints.
    expect(d30!.volume).toEqual([
      { mint: USDC_MINT, symbol: "USDC", decimals: 6, raw: "2000000" },
      { mint: SOL_MINT, symbol: "SOL", decimals: 9, raw: "250000000" },
    ]);
    expect(all).toMatchObject({
      window: "all",
      since: null,
      purchases: 3,
      buyers: 2,
    });
    expect(all!.volume.find((v) => v.mint === USDC_MINT)!.raw).toBe("5000000");
  });

  it("volume sums are exact beyond 2^53 (numeric, not float)", async () => {
    await receipt({ basketId: alices2, amount: "9007199254740993" });
    await receipt({ basketId: alices2, amount: "9007199254740993" });
    const usage = await receiptUsage(t.db, { basketId: alices2 }, NOW);
    expect(usage.state === "ok" && usage.windows[2]!.volume[0]!.raw).toBe(
      "18014398509481986",
    );
  });

  it("a creator's usage spans their baskets only; an order recorded after as-of is ignored; a skewed block time does not matter", async () => {
    await receipt({ basketId: alices, at: new Date(NOW.getTime() + DAY) });
    const usage = await receiptUsage(t.db, { creatorWallet: ALICE }, NOW);
    expect(usage.state === "ok" && usage.windows[2]).toMatchObject({
      purchases: 5,
    });
    const bob = await getCreatorStats(t.db, BOB, { now: NOW });
    expect(bob.usage.state === "ok" && bob.usage.windows[2]).toMatchObject({
      purchases: 1,
      buyers: 1,
    });
  });
});
