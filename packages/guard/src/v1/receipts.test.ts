import { describe, expect, test } from "vitest";
import { executionsFromReceipts, installmentRecord } from "./receipts";
import { k } from "./test/fixtures";

const event = {
  plan: k(0),
  period: 3,
  newlySkipped: 1,
  periodComplete: true,
  legs: [0, 1].map((leg) => ({
    leg,
    mint: k(4 + leg),
    amountIn: 4_990_000n,
    fee: 10_000n,
    amountOut: 2_158n + BigInt(leg),
    minOut: 2_100n,
    oraclePrice: 23_142_000_000n,
    oracleExpo: -8,
    oraclePublishTime: 1_763_000_000n,
    multiplierFp: 1_000_000_000_000n,
  })),
};

describe("installment receipts", () => {
  test("records exact strings and the funding spent, and round-trips to timeline executions", () => {
    const record = installmentRecord(event);
    expect(record.amountIn).toBe(10_000_000n);
    expect(record.legs[1]).toMatchObject({
      amountOut: "2159",
      oracleExpo: -8,
      periodComplete: true,
    });
    const map = executionsFromReceipts([
      { signature: "s1", period: 3, blockTime: 9n, legs: record.legs },
      { signature: "s0", period: null, blockTime: null, legs: record.legs },
      { signature: "bad", period: 2, blockTime: null, legs: [{ nope: 1 }] },
    ]);
    expect([...map.keys()]).toEqual([3]);
    const [execution] = map.get(3)!;
    expect(execution!.periodComplete).toBe(true);
    expect(execution!.legs.map((l) => l.amountOut)).toEqual([2_158n, 2_159n]);
    expect(execution!.legs[0]!.oraclePublishTime).toBe(1_763_000_000n);
  });
});
