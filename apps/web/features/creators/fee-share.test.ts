import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USDC_MINT } from "@/features/trade/schema";
import { parseEnv } from "@/server/env.schema";
import { feeSettings } from "@/server/env.fees";
import { BASE_ENV } from "@/server/test/base-env";
import { feeFor, ledgerSummary, syncFeeShareLedger } from "./fee-share";
import { publishBasket } from "./server";
import { createTestDb } from "./test/db";
import { ALICE, content, newId, registry } from "./test/fixtures";

/** M11 Step 5a: the fee-share ledger is accounting only; the platform fee is 0 in this build. */
let t: Awaited<ReturnType<typeof createTestDb>>;
let basket: string;
const NOW = new Date("2026-11-20T12:00:00.000Z");
let n = 0;
async function receipt(status: string, request: string, amount = "2000000") {
  await t.client.query(
    `INSERT INTO receipts (signature, wallet, basket_id, kind, amount_in, mint_in, legs, status, created_at)
     VALUES ($1, 'Buyer', $2, 'basket', $3, $4, $5, $6, $7)`,
    [
      `fee-sig-${++n}`,
      basket,
      amount,
      USDC_MINT,
      JSON.stringify([{ requestId: request }]),
      status,
      new Date(NOW.getTime() - 60_000),
    ],
  );
}

beforeAll(async () => {
  t = await createTestDb();
  const { rows } = await t.client.query<{ id: string }>(
    `INSERT INTO invites (code_hash, max_uses, uses, expires_at) VALUES ('fee', 1, 1, now() + interval '1 day') RETURNING id`,
  );
  await t.client.query(
    `INSERT INTO creators (wallet, display_name, invite_id) VALUES ($1, 'Alice', $2)`,
    [ALICE, rows[0]!.id],
  );
  basket = newId();
  await publishBasket(t.db, {
    wallet: ALICE,
    basketId: basket,
    content: content(),
    registry,
    now: new Date("2026-10-01T00:00:00Z"),
  });
});
afterAll(async () => t.client.close());

describe("feeFor (bigint, rounded down)", () => {
  it("is 0 with no platform fee, whatever the share", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }),
        fc.integer({ min: 0, max: 10_000 }),
        (notional, share) => {
          expect(
            feeFor(notional, { platformFeeBps: 0, creatorShareBps: share }),
          ).toEqual({ fee: 0n, share: 0n });
        },
      ),
    );
  });
});

describe("syncFeeShareLedger", () => {
  it("one entry per confirmed creator-basket order, recorded once; pending and failed are not", async () => {
    await receipt("confirmed", "order-1", "1500000");
    await receipt("confirmed", "order-1", "500000");
    await receipt("pending", "order-2");
    await receipt("failed", "order-3");
    const settings = { platformFeeBps: 0 as const, creatorShareBps: 2_500 };
    expect(await syncFeeShareLedger(t.db, settings, NOW)).toBe(1);
    expect(await syncFeeShareLedger(t.db, settings, NOW)).toBe(0);
    const { rows } = await t.client.query<Record<string, unknown>>(
      "SELECT order_id, creator_wallet, notional_raw, platform_fee_bps, share_bps, fee_raw, share_raw FROM fee_share_ledger",
    );
    expect(rows).toEqual([
      {
        order_id: "order-1",
        creator_wallet: ALICE,
        notional_raw: "2000000",
        platform_fee_bps: 0,
        share_bps: 2500,
        fee_raw: "0",
        share_raw: "0",
      },
    ]);
    expect(await ledgerSummary(t.db, ALICE, basket)).toEqual({
      entries: 1,
      shareRaw: "0",
    });
  });
});

describe("fee settings", () => {
  const problems = (env: Record<string, string>) => {
    const result = parseEnv({ ...BASE_ENV, ...env });
    return result.ok ? [] : result.error.issues.map((i) => i.variable);
  };
  it("a platform fee other than 0 is refused at boot (5b is not approved)", () => {
    expect(problems({ OVELO_PLATFORM_FEE_BPS: "0" })).toEqual([]);
    expect(problems({ OVELO_PLATFORM_FEE_BPS: "25" })).toEqual([
      "OVELO_PLATFORM_FEE_BPS",
    ]);
  });
  it("the creator share is 0-10000 bps and defaults to 0", () => {
    expect(problems({ OVELO_CREATOR_FEE_SHARE_BPS: "10001" })).toEqual([
      "OVELO_CREATOR_FEE_SHARE_BPS",
    ]);
    expect(feeSettings({})).toEqual({ platformFeeBps: 0, creatorShareBps: 0 });
    expect(
      feeSettings({ OVELO_CREATOR_FEE_SHARE_BPS: "3000" }).creatorShareBps,
    ).toBe(3000);
  });
});
