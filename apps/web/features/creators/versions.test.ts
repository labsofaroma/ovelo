import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { basketVersions } from "@/server/db/schema";
import { publishBasket } from "./server";
import { createTestDb } from "./test/db";
import {
  ALICE,
  content,
  MINT_A,
  MINT_B,
  newId,
  NOW,
  registry,
} from "./test/fixtures";

/** Migration 0002: every published version is kept, insert-only (M5b B3, M5-NEEDS #5). */
let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
  await t.client.query(
    `INSERT INTO invites (code_hash, max_uses, uses, expires_at) VALUES ('h', 1, 1, now() + interval '1 day')`,
  );
  const [invite] = (
    await t.client.query<{ id: string }>(`SELECT id FROM invites LIMIT 1`)
  ).rows;
  await t.client.query(
    `INSERT INTO creators (wallet, display_name, invite_id) VALUES ($1, 'Alice', $2)`,
    [ALICE, invite!.id],
  );
});
afterAll(async () => {
  await t.client.close();
});

const versions = (id: string) =>
  t.db
    .select()
    .from(basketVersions)
    .where(eq(basketVersions.basketId, id))
    .orderBy(asc(basketVersions.version));

describe("basket_versions", () => {
  it("records version 1, then each republish, with the exact weights of each", async () => {
    const id = newId();
    const first = content();
    await publishBasket(t.db, {
      wallet: ALICE,
      basketId: id,
      content: first,
      registry,
      now: NOW,
    });
    const second = {
      ...first,
      allocations: [
        { mint: MINT_A, weightBps: 7000 },
        { mint: MINT_B, weightBps: 3000 },
      ],
    };
    const later = new Date(NOW.getTime() + 60_000);
    const view = await publishBasket(t.db, {
      wallet: ALICE,
      basketId: id,
      content: second,
      registry,
      now: later,
    });
    expect(view.version).toBe(2);
    const rows = await versions(id);
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
    expect(rows[0]!.allocations).toEqual([
      { mint: MINT_A, symbol: "AAPLx", weightBps: 3334 },
      { mint: MINT_B, symbol: "NVDAx", weightBps: 3333 },
      {
        mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
        symbol: "TSLAx",
        weightBps: 3333,
      },
    ]);
    expect(rows[1]!.allocations).toEqual([
      { mint: MINT_A, symbol: "AAPLx", weightBps: 7000 },
      { mint: MINT_B, symbol: "NVDAx", weightBps: 3000 },
    ]);
    expect(rows[1]!.publishedAt.toISOString()).toBe(later.toISOString());
  });

  it("is insert-only: UPDATE, DELETE and TRUNCATE are refused", async () => {
    const id = newId();
    await publishBasket(t.db, {
      wallet: ALICE,
      basketId: id,
      content: content(),
      registry,
      now: NOW,
    });
    for (const statement of [
      `UPDATE basket_versions SET name = 'changed' WHERE basket_id = '${id}'`,
      `DELETE FROM basket_versions WHERE basket_id = '${id}'`,
      `TRUNCATE basket_versions`,
    ])
      await expect(t.client.query(statement)).rejects.toThrow(/insert-only/);
    expect(await versions(id)).toHaveLength(1);
  });

  it("a basket with versions cannot be hard-deleted (archive instead)", async () => {
    const id = newId();
    await publishBasket(t.db, {
      wallet: ALICE,
      basketId: id,
      content: content(),
      registry,
      now: NOW,
    });
    await expect(
      t.client.query(`DELETE FROM baskets WHERE id = $1`, [id]),
    ).rejects.toThrow();
  });

  it("a version cannot be recorded twice", async () => {
    const id = newId();
    await publishBasket(t.db, {
      wallet: ALICE,
      basketId: id,
      content: content(),
      registry,
      now: NOW,
    });
    await expect(
      t.client.query(
        `INSERT INTO basket_versions (basket_id, version, name, ticker, allocations, published_at) VALUES ($1, 1, 'x', 'X', '[]', now())`,
        [id],
      ),
    ).rejects.toThrow();
  });
});
