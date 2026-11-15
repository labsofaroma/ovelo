import type { Address } from "@solana/kit";
import type { Plan } from "@aroma/guard";
import { describe, expect, it } from "vitest";
import { memoryDb } from "./local-stores";
import { notifyExecuted, notifyFailed } from "./notify";
import type { KeeperRpc } from "./rpc";
import { silent } from "./test/world";

const OWNER = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz" as Address;
const PLAN = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" as Address;
const plan = (over: Partial<Plan> = {}) =>
  ({
    owner: OWNER,
    fundingMint: "So11111111111111111111111111111111111111112",
    fundingTokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    fundingAmount: 10_000_000n,
    periods: 4,
    executedPeriods: 1,
    skippedPeriods: 0,
    ...over,
  }) as unknown as Plan;
const rpc = (amount: string | null) =>
  ({
    getTokenAccountBalance: () => ({
      send: async () => {
        if (amount === null) throw new Error("could not find account");
        return { value: { amount, decimals: 6 } };
      },
    }),
  }) as unknown as KeeperRpc;

describe("M11 devnet notification events", () => {
  it("a round that ran, with enough balance left: one 'executed' event", async () => {
    const db = memoryDb();
    await notifyExecuted(
      { rpc: rpc("50000000"), db, log: silent },
      PLAN,
      plan(),
      0,
      "sig",
    );
    expect([...db.notifications.keys()]).toEqual([`plan:${PLAN}:0:executed`]);
  });

  it("balance below the next round: 'executed' and 'low balance'; once each on a re-run", async () => {
    const db = memoryDb();
    const deps = { rpc: rpc("5"), db, log: silent };
    await notifyExecuted(deps, PLAN, plan(), 1, "sig");
    await notifyExecuted(deps, PLAN, plan(), 1, "sig");
    expect([...db.notifications.values()].map((n) => n.kind)).toEqual([
      "plan_round_executed",
      "plan_low_balance",
    ]);
  });

  it("no low-balance event after the last round, and a missing account counts as 0", async () => {
    const db = memoryDb();
    await notifyExecuted(
      { rpc: rpc(null), db, log: silent },
      PLAN,
      plan({ executedPeriods: 4 }),
      3,
      "sig",
    );
    expect([...db.notifications.values()].map((n) => n.kind)).toEqual([
      "plan_round_executed",
    ]);
  });

  it("a dead-lettered round: one 'failed' event with the code; a db error never throws", async () => {
    const db = memoryDb();
    await notifyFailed(
      { db, log: silent },
      PLAN,
      OWNER,
      2,
      "RETRIES_EXHAUSTED",
    );
    expect(db.notifications.get(`plan:${PLAN}:2:failed`)?.kind).toBe(
      "plan_round_failed",
    );
    const broken = {
      ...db,
      recordNotification: async () => {
        throw new Error("down");
      },
    };
    await expect(
      notifyFailed({ db: broken, log: silent }, PLAN, OWNER, 3, "X"),
    ).resolves.toBeUndefined();
  });
});
