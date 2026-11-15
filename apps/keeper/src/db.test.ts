import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keeperDb, plansIndex, receipts, type KeeperDb } from "./db";

/** The web app's migrations are the schema's source of truth; the keeper only declares columns. */
const MIGRATIONS = new URL("../../web/server/db/migrations/", import.meta.url);
let client: PGlite;
let db: KeeperDb;

beforeAll(async () => {
  client = new PGlite();
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const statement of readFileSync(
      new URL(file, MIGRATIONS),
      "utf8",
    ).split("--> statement-breakpoint"))
      if (statement.trim()) await client.exec(statement);
  db = keeperDb(drizzle({ client }) as never);
});
afterAll(async () => client.close());

const row = (pda: string, over = {}) => ({
  pda,
  owner: "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz",
  fundingMint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  nonce: "1",
  status: "active" as const,
  nextDueAt: 1_000n,
  lastPeriod: null,
  skippedPeriods: 0,
  executedPeriods: 0,
  periods: 4,
  ...over,
});

describe("keeper tables against the web migrations", () => {
  it("every declared column exists with the same name in the migrated database", async () => {
    for (const [table, columns] of [
      ["plans_index", getTableColumns(plansIndex)],
      ["receipts", getTableColumns(receipts)],
    ] as const) {
      const { rows } = await client.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = $1`,
        [table],
      );
      const present = new Set(rows.map((r) => r.column_name));
      for (const column of Object.values(columns))
        expect(present.has(column.name), `${table}.${column.name}`).toBe(true);
    }
  });

  it("due rows are active and due by now, oldest first; upsert, close and insert-once receipts", async () => {
    await db.upsertRows([
      row("p2", { nextDueAt: 2_000n, nonce: "2" }),
      row("p1", { nextDueAt: 1_000n }),
      row("p3", { nextDueAt: 9_000n, nonce: "3" }),
      row("p4", { status: "paused", nonce: "4" }),
    ]);
    expect(
      (await db.dueRows(new Date(5_000_000), 10)).map((r) => r.pda),
    ).toEqual(["p1", "p2"]);
    await db.upsertRows([
      row("p1", { executedPeriods: 1, lastPeriod: 0, nextDueAt: 3_000n }),
    ]);
    expect((await db.allRows()).find((r) => r.pda === "p1")).toMatchObject({
      executedPeriods: 1,
      lastPeriod: 0,
      nextDueAt: 3_000n,
    });
    await db.closeRows(["p2"]);
    await db.closeRows([]);
    expect(
      (await db.dueRows(new Date(5_000_000), 10)).map((r) => r.pda),
    ).toEqual(["p1"]);
    const receipt = {
      signature: "s1",
      wallet: "w",
      amountIn: "10",
      mintIn: "m",
      legs: [{ leg: 0 }],
      slot: 5n,
      blockTime: new Date(0),
      planPda: "p1",
      period: 0,
    };
    expect(await db.insertInstallment(receipt)).toBe(true);
    expect(await db.insertInstallment(receipt)).toBe(false);
    const { rows } = await client.query<{
      kind: string;
      status: string;
      period: number;
    }>("select kind, status, period from receipts");
    expect(rows).toEqual([
      { kind: "installment", status: "confirmed", period: 0 },
    ]);
  });

  it("M11: records a devnet notification event once, and only for a subscribed owner", async () => {
    const event = {
      id: "plan:p1:0:executed",
      wallet: "owner-a",
      kind: "plan_round_executed",
      payload: { plan: "p1", period: 0 },
    };
    expect(await db.recordNotification(event)).toBe(false);
    await client.query(
      `insert into notification_subscriptions (wallet, channel, status, events, address, verified_at)
       values ('owner-a', 'telegram', 'active', '["plan_round_executed"]', '{"chatId": 1}', now())`,
    );
    expect(await db.recordNotification(event)).toBe(true);
    expect(await db.recordNotification(event)).toBe(false);
    const { rows } = await client.query<{ cluster: string; kind: string }>(
      "select cluster, kind from notification_events",
    );
    expect(rows).toEqual([{ cluster: "devnet", kind: "plan_round_executed" }]);
  });
});
