import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Database } from "@/server/db/client";
import { createTestDb } from "@/features/creators/test/db";
import { dbInvestStore, type PlanReceipt } from "./store";

let client: PGlite;
let store: ReturnType<typeof dbInvestStore>;

beforeAll(async () => {
  const created = await createTestDb();
  client = created.client;
  store = dbInvestStore(created.db as unknown as Database);
});
afterAll(async () => client.close());

const row = (pda: string, over = {}) => ({
  pda,
  owner: "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz",
  fundingMint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  nonce: "1",
  status: "active" as const,
  nextDueAt: 1_763_100_000n,
  lastPeriod: null,
  skippedPeriods: 0,
  executedPeriods: 0,
  periods: 4,
  ...over,
});
const receipt = (
  signature: string,
  over: Partial<PlanReceipt> = {},
): PlanReceipt => ({
  signature,
  wallet: "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz",
  kind: "installment",
  amountIn: "10000000",
  mintIn: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  legs: [{ leg: 0 }],
  slot: 9n,
  blockTime: new Date("2026-11-14T00:00:00Z"),
  planPda: "plan-1",
  period: 2,
  status: "confirmed",
  ...over,
});

describe("dbInvestStore on the real migrations (PGlite)", () => {
  it("upserts, reads by owner, and closes plans_index rows", async () => {
    await store.upsertRows([row("plan-1"), row("plan-2", { nonce: "2" })]);
    await store.upsertRows([
      row("plan-1", { executedPeriods: 1, lastPeriod: 0, nextDueAt: null }),
    ]);
    const rows = await store.indexRows(
      "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz",
    );
    expect(rows.find((r) => r.pda === "plan-1")).toMatchObject({
      executedPeriods: 1,
      lastPeriod: 0,
      nextDueAt: null,
      periods: 4,
    });
    expect(rows.find((r) => r.pda === "plan-2")?.nextDueAt).toBe(
      1_763_100_000n,
    );
    await store.closeRows(["plan-2"]);
    await store.closeRows([]);
    expect(
      (await store.indexRows()).find((r) => r.pda === "plan-2")?.status,
    ).toBe("closed");
  });

  it("receipts are insert-once by signature and readable per plan with their period", async () => {
    expect(await store.insertReceipt(receipt("sig-a"))).toBe(true);
    expect(await store.insertReceipt(receipt("sig-a", { amountIn: "1" }))).toBe(
      false,
    );
    await store.insertReceipt(
      receipt("sig-b", {
        kind: "plan_create",
        period: null,
        planPda: "plan-1",
      }),
    );
    const rows = await store.receiptsForPlans(["plan-1"]);
    expect(
      rows.map((r) => [r.signature, r.kind, r.period, r.amountIn]).sort(),
    ).toEqual([
      ["sig-a", "installment", 2, "10000000"],
      ["sig-b", "plan_create", null, "10000000"],
    ]);
    expect(await store.receiptsForPlans([])).toEqual([]);
  });

  it("the database refuses a plan receipt without its plan and a negative period", async () => {
    await expect(
      store.insertReceipt(receipt("sig-c", { planPda: null as never })),
    ).rejects.toThrow();
    await expect(
      store.insertReceipt(receipt("sig-d", { period: -1 })),
    ).rejects.toThrow();
  });
});
