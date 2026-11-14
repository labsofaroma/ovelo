import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { dbReceipts } from "./receipts-db";
import { receiptRows } from "./store";

/** The receipts writer against the real migrations in an in-process Postgres (PGlite). */
const MIGRATIONS = new URL("../../../server/db/migrations/", import.meta.url);
let client: PGlite;
let writer: ReturnType<typeof dbReceipts>;

const WALLET = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const MINT_IN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT_A = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const MINT_B = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

beforeAll(async () => {
  client = new PGlite();
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(new URL(file, MIGRATIONS), "utf8");
    for (const statement of sql.split("--> statement-breakpoint"))
      if (statement.trim()) await client.exec(statement);
  }
  writer = dbReceipts(drizzle(client, { schema }) as unknown as Database);
});
afterAll(async () => {
  await client.close();
});

describe("dbReceipts", () => {
  it("writes one pending row per transaction with raw-integer amounts, then confirms it once", async () => {
    const rows = receiptRows({
      id: "8f0e3c7a-3d4b-4b8e-9c2a-1f6d5e4c3b2a",
      taker: WALLET,
      signatures: ["sig-one", "sig-two"],
      receipt: {
        kind: "basket",
        basketId: "sol-core",
        inputMint: MINT_IN,
        inAmount: "2000050",
        legs: [
          {
            mint: MINT_A,
            inputAmount: "1000000",
            outAmount: "5",
            minimumAmount: "4",
            tx: 0,
          },
          {
            mint: MINT_B,
            inputAmount: "1000000",
            outAmount: "7",
            minimumAmount: "6",
            tx: 1,
          },
        ],
      },
    });
    await writer.insertPending(rows);
    await writer.insertPending(rows); // idempotent
    let listed = await writer.listByWallet(WALLET, 10);
    expect(listed).toHaveLength(2);
    expect(listed.map((r) => r.amountIn).sort()).toEqual([
      "1000000",
      "1000000",
    ]);
    expect(
      listed.every((r) => r.status === "pending" && r.kind === "basket"),
    ).toBe(true);
    await writer.mark(["sig-one", "sig-two"], {
      status: "confirmed",
      slot: 123n,
      blockTime: new Date("2026-11-13T00:00:00Z"),
    });
    // A final status is never overwritten.
    await writer.mark(["sig-one"], {
      status: "failed",
      slot: 1n,
      blockTime: null,
    });
    listed = await writer.listByWallet(WALLET, 10);
    expect(
      listed.every((r) => r.status === "confirmed" && r.slot === 123n),
    ).toBe(true);
    expect(listed[0]!.legs[0]).toMatchObject({ basket: "sol-core" });
  });

  it("the database refuses a non-integer amount (rule 5)", async () => {
    await expect(
      writer.insertPending([
        {
          signature: "bad",
          wallet: WALLET,
          basketId: null,
          kind: "spot",
          amountIn: "1.5",
          mintIn: MINT_IN,
          legs: [],
        },
      ]),
    ).rejects.toThrow();
  });
});
