import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/features/creators/test/db";
import type { NotifyDb } from "./outbox";
import { scanReceipts } from "./scan";
import { activeSub, at, T0 } from "../test/fixtures";

let db: NotifyDb;
let client: PGlite;
beforeAll(async () => {
  ({ db, client } = await createTestDb());
});
afterAll(async () => client.close());
beforeEach(async () => {
  await client.exec(
    "DELETE FROM notification_events; DELETE FROM notification_subscriptions; DELETE FROM receipts; DELETE FROM baskets; DELETE FROM creators;",
  );
});

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const deps = {
  symbolOf: (m: string) => (m === "MINTx" ? "TSLAx" : null),
  basketNameOf: () => null,
};
async function receipt(
  sig: string,
  over: {
    wallet?: string;
    status?: string;
    kind?: string;
    request?: string;
    basketId?: string | null;
    created?: Date;
    amount?: string;
  } = {},
) {
  await client.query(
    `INSERT INTO receipts (signature, wallet, basket_id, kind, amount_in, mint_in, legs, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      sig,
      over.wallet ?? "buyer",
      over.basketId ?? null,
      over.kind ?? "spot",
      over.amount ?? "25000000",
      USDC,
      JSON.stringify([
        { mint: "MINTx", requestId: over.request ?? sig, basket: null },
      ]),
      over.status ?? "confirmed",
      (over.created ?? at(60_000)).toISOString(),
    ],
  );
}
const events = async () =>
  (
    await client.query<{
      id: string;
      wallet: string;
      kind: string;
      payload: Record<string, unknown>;
    }>("SELECT id, wallet, kind, payload FROM notification_events ORDER BY id")
  ).rows;

describe("receipt scan → events", () => {
  it("nothing for a wallet without a subscription (no data collected about it)", async () => {
    await receipt("s1");
    expect(await scanReceipts(db, deps, at(120_000))).toBe(0);
  });

  it("a confirmed spot order: one event with the receipt's amount; a re-scan adds nothing", async () => {
    await activeSub(db, "buyer", "telegram", ["trade_confirmed"]);
    await receipt("s1");
    expect(await scanReceipts(db, deps, at(120_000))).toBe(1);
    expect(await scanReceipts(db, deps, at(180_000))).toBe(0);
    const [event] = await events();
    expect(event).toMatchObject({
      id: "trade:s1:confirmed",
      kind: "trade_confirmed",
      payload: {
        label: "TSLAx",
        amountRaw: "25000000",
        mint: USDC,
        signature: "s1",
      },
    });
  });

  it("a basket order of two transactions is one order: failed if either failed", async () => {
    await activeSub(db, "buyer", "telegram", ["trade_failed"]);
    await receipt("a", {
      kind: "basket",
      request: "req-1",
      status: "confirmed",
    });
    await receipt("b", { kind: "basket", request: "req-1", status: "failed" });
    await scanReceipts(db, deps, at(120_000));
    expect((await events()).map((e) => e.id)).toEqual(["trade:req-1:failed"]);
  });

  it("pending: nothing before 15 minutes, 'unconfirmed' after", async () => {
    await activeSub(db, "buyer", "telegram", ["trade_unconfirmed"]);
    await receipt("p", { status: "pending" });
    expect(await scanReceipts(db, deps, at(5 * 60_000))).toBe(0);
    expect(await scanReceipts(db, deps, at(16 * 60_000 + 60_000))).toBe(1);
    expect((await events())[0]?.kind).toBe("trade_unconfirmed");
  });

  it("orders from before the subscription was verified are not scanned", async () => {
    await activeSub(
      db,
      "buyer",
      "telegram",
      ["trade_confirmed"],
      at(10 * 60_000),
    );
    await receipt("early", { created: at(60_000) });
    expect(await scanReceipts(db, deps, at(20 * 60_000))).toBe(0);
  });

  it("a confirmed creator-basket order notifies the creator (not the buyer's wallet)", async () => {
    await client.query(
      "INSERT INTO creators (wallet, display_name) VALUES ('maker', 'Maker')",
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO baskets (creator_wallet, name, ticker, category, status) VALUES ('maker', 'Maker Core', 'MKC', 'tech', 'draft') RETURNING id`,
    );
    await activeSub(db, "maker", "push", ["creator_basket_bought"]);
    await receipt("c1", {
      kind: "basket",
      basketId: rows[0]!.id,
      request: "req-9",
    });
    expect(await scanReceipts(db, deps, at(120_000))).toBe(1);
    expect(await events()).toEqual([
      expect.objectContaining({
        id: "creator-buy:req-9",
        wallet: "maker",
        kind: "creator_basket_bought",
        payload: expect.objectContaining({
          basketName: "Maker Core",
          amountRaw: "25000000",
        }),
      }),
    ]);
    void T0;
  });
});
