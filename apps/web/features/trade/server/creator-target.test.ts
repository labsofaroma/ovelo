import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveBasket,
  publishBasket,
  saveDraft,
} from "@/features/creators/server";
import { createTestDb } from "@/features/creators/test/db";
import {
  ALICE,
  content,
  newId,
  NOW,
  registry,
} from "@/features/creators/test/fixtures";
import type { Database } from "@/server/db/client";
import { USDC_MINT } from "../schema";
import { loadCreatorTarget } from "./creator-target";
import { dbReceipts } from "./receipts-db";
import { receiptRows } from "./store";

/** Creator baskets from Postgres as trade targets, and their receipts (PGlite, real migrations). */
let t: Awaited<ReturnType<typeof createTestDb>>;

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

describe("loadCreatorTarget", () => {
  it("a published basket resolves with its current version and weights", async () => {
    const id = await publish();
    await publishBasket(t.db, {
      wallet: ALICE,
      basketId: id,
      content: content(),
      registry,
      now: NOW,
    });
    const target = await loadCreatorTarget(t.db, id);
    expect(target).toMatchObject({ id, version: 2, status: "published" });
    expect(target!.allocations.reduce((s, a) => s + a.weightBps, 0)).toBe(
      10_000,
    );
  });

  it("an archived basket resolves as archived (the resolver refuses to sell it)", async () => {
    const id = await publish();
    await archiveBasket(t.db, { wallet: ALICE, basketId: id });
    expect((await loadCreatorTarget(t.db, id))?.status).toBe("archived");
  });

  it("drafts and unknown ids resolve to null", async () => {
    const id = newId();
    await saveDraft(t.db, {
      wallet: ALICE,
      basketId: id,
      content: content(),
      registry,
    });
    expect(await loadCreatorTarget(t.db, id)).toBeNull();
    expect(await loadCreatorTarget(t.db, newId())).toBeNull();
  });
});

describe("creator basket receipts", () => {
  it("are written with basket_id (FK) and the version on each leg; curated stay null", async () => {
    const id = await publish();
    const writer = dbReceipts(t.db as unknown as Database);
    const record = (basketId: string, signature: string) => ({
      id: crypto.randomUUID(),
      taker: ALICE,
      signatures: [signature],
      receipt: {
        kind: "basket" as const,
        basketId,
        ...(basketId === id ? { basketVersion: 1 } : {}),
        inputMint: USDC_MINT,
        inAmount: "1000050",
        legs: [
          {
            mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
            inputAmount: "1000000",
            outAmount: "5",
            minimumAmount: "4",
            tx: 0,
          },
        ],
      },
    });
    await writer.insertPending([
      ...receiptRows(record(id, "sig-creator")),
      ...receiptRows(record("sol-core", "sig-curated")),
    ]);
    const { rows } = await t.client.query<{
      signature: string;
      basket_id: string | null;
      legs: { basketVersion?: number }[];
    }>(
      `SELECT signature, basket_id, legs FROM receipts WHERE signature IN ('sig-creator', 'sig-curated') ORDER BY signature`,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        signature: "sig-creator",
        basket_id: id,
        legs: [expect.objectContaining({ basketVersion: 1 })],
      }),
      expect.objectContaining({ signature: "sig-curated", basket_id: null }),
    ]);
    // The version on the leg points at the exact weights bought.
    const versions = await t.client.query(
      `SELECT version FROM basket_versions WHERE basket_id = $1`,
      [id],
    );
    expect(versions.rows).toEqual([{ version: 1 }]);
  });
});
