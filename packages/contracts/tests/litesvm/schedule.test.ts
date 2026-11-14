/** Schedule (replay, catch-up, skip), pauses, and close + revoke in one transaction. */
import { describe, expect, test } from "vitest";
import * as v1 from "../../../../apps/web/lib/sdk/guard/v1";
import { errorCode, World } from "./world";

const DAY = 86_400n;

describe("schedule", () => {
  test("a period cannot be replayed, and a future period cannot run early", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan({ periods: 3 });
    expect((await w.execute(plan, 0, 1)).ok).toBe(true);
    expect(errorCode((await w.execute(plan, 0, 1)).logs)).toBe("NothingDue");
    expect(errorCode((await w.execute(plan, 1, 1)).logs)).toBe("NothingDue");
    w.at(DAY);
    expect(errorCode((await w.execute(plan, 0, 1)).logs)).toBe(
      "UnexpectedPeriod",
    );
    expect((await w.execute(plan, 1, 1)).ok).toBe(true);
  });

  test("catch-up inside the window: the missed period runs late, oldest first, then the current one", async () => {
    const w = await World.create({ stocks: 1, window: 1 });
    const plan = await w.createPlan({ periods: 4 });
    expect((await w.execute(plan, 0, 1)).ok).toBe(true);
    w.at(2n * DAY + 60n); // period 1 was missed; index 2
    expect(errorCode((await w.execute(plan, 2, 1)).logs)).toBe(
      "UnexpectedPeriod",
    ); // oldest first
    expect((await w.execute(plan, 1, 1)).ok).toBe(true); // catch-up
    // The delegation allows (1 + window) installments per period, so period 2 runs in the same slot.
    expect((await w.execute(plan, 2, 1)).ok).toBe(true);
    const p = w.plan(plan);
    expect([p.executedPeriods, p.skippedPeriods, p.lastExecutedPeriod]).toEqual(
      [3, 0, 2],
    );
  });

  test("periods older than the window are skipped and counted", async () => {
    const w = await World.create({ stocks: 1, window: 1 });
    const plan = await w.createPlan({ periods: 5 });
    expect((await w.execute(plan, 0, 1)).ok).toBe(true);
    w.at(3n * DAY + 60n); // index 3: period 1 is outside the window
    const r = await w.execute(plan, 2, 1);
    expect(r.ok, r.logs.join("\n")).toBe(true);
    const p = w.plan(plan);
    expect([p.executedPeriods, p.skippedPeriods, p.lastExecutedPeriod]).toEqual(
      [2, 1, 2],
    );
    const view = v1.viewPlan(plan, p, w.env.now);
    expect(view.due).toEqual({ period: 3, newlySkipped: 0 });
    expect(view.settledPeriods).toBe(3);
  });

  test("the final period can be caught up one period after the schedule ends", async () => {
    const w = await World.create({ stocks: 1, window: 1 });
    const plan = await w.createPlan({ periods: 2 });
    expect((await w.execute(plan, 0, 1)).ok).toBe(true);
    w.at(2n * DAY + 10n); // after expires_at, inside the delegation's grace period
    expect((await w.execute(plan, 1, 1)).ok).toBe(true);
    expect(w.plan(plan).executedPeriods).toBe(2);
    w.at(3n * DAY + 10n);
    expect(errorCode((await w.execute(plan, 2, 1)).logs)).toBe("NothingDue");
    expect(v1.viewPlan(plan, w.plan(plan), w.env.now).status).toBe("finished");
  });

  test("never more than periods × amount is pulled, whatever the timing", async () => {
    const w = await World.create({ stocks: 1, window: 1 });
    const amount = 25_000_000n;
    const plan = await w.createPlan({ periods: 3, amount });
    const start = w.env.tokenAmount(w.ownerUsd);
    for (const t of [
      0n,
      10n,
      DAY * 2n,
      DAY * 2n + 5n,
      DAY * 2n + 9n,
      DAY * 3n,
      DAY * 9n,
    ]) {
      w.at(t);
      for (let period = 0; period < 5; period += 1)
        await w.execute(plan, period, 1);
    }
    expect(start - w.env.tokenAmount(w.ownerUsd)).toBeLessThanOrEqual(
      3n * amount,
    );
    const p = w.plan(plan);
    expect(p.executedPeriods + p.skippedPeriods).toBeLessThanOrEqual(3);
  });
});

describe("pauses", () => {
  test("config paused: create and execute are refused; close works", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan({ nonce: 1n });
    await w.env.send(w.admin, [
      await v1.buildSetPausedInstruction(w.admin, true),
    ]);
    expect(errorCode((await w.execute(plan, 0, 1)).logs)).toBe(
      "ProtocolPaused",
    );
    const create = await w.env.trySend(
      w.owner,
      await w.createPlanIxs({ nonce: 2n, initId: await w.authorityInitId() }),
    );
    expect(errorCode(create.logs)).toBe("ProtocolPaused");
    const close = await w.env.trySend(w.owner, await closeIxs(w, plan));
    expect(close.ok, close.logs.join("\n")).toBe(true);
    await w.env.send(w.admin, [
      await v1.buildSetPausedInstruction(w.admin, false),
    ]);
  });

  test("owner paused: execution is refused until resumed; pausing twice is refused", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan();
    const { getPausePlanInstruction, getResumePlanInstruction } =
      await import("../../../../apps/web/lib/sdk/guard/v1/generated");
    await w.env.send(w.owner, [
      getPausePlanInstruction({ owner: w.owner, plan }),
    ]);
    expect(
      errorCode(
        (
          await w.env.trySend(w.owner, [
            getPausePlanInstruction({ owner: w.owner, plan }),
          ])
        ).logs,
      ),
    ).toBe("PauseStateUnchanged");
    expect(errorCode((await w.execute(plan, 0, 1)).logs)).toBe("PlanPaused");
    const stranger = await w.env.signer();
    const notOwner = await w.env.trySend(stranger, [
      getResumePlanInstruction({ owner: stranger, plan }),
    ]);
    expect(errorCode(notOwner.logs)).toBe("ConstraintHasOne");
    await w.env.send(w.owner, [
      getResumePlanInstruction({ owner: w.owner, plan }),
    ]);
    expect((await w.execute(plan, 0, 1)).ok).toBe(true);
  });

  test("close while the plan and the protocol are both paused, mid-period", async () => {
    const w = await World.create({ stocks: 2 });
    const plan = await w.createPlan({ amount: 50_000_000n });
    expect((await w.execute(plan, 0, 0b01)).ok).toBe(true); // leg 1 still in staging
    const { getPausePlanInstruction } =
      await import("../../../../apps/web/lib/sdk/guard/v1/generated");
    await w.env.send(w.owner, [
      getPausePlanInstruction({ owner: w.owner, plan }),
    ]);
    await w.env.send(w.admin, [
      await v1.buildSetPausedInstruction(w.admin, true),
    ]);
    const before = w.env.tokenAmount(w.ownerUsd);
    const close = await w.env.trySend(w.owner, await closeIxs(w, plan));
    expect(close.ok, close.logs.join("\n")).toBe(true);
    expect(w.env.tokenAmount(w.ownerUsd) - before).toBe(25_000_000n); // the unspent leg is returned
  });
});

describe("close + revoke", () => {
  test("one transaction closes the plan and staging, revokes the delegation and the authority, rent to the owner", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan({ periods: 3 });
    expect((await w.execute(plan, 0, 1)).ok).toBe(true);
    const p = w.plan(plan);
    const staging = await v1.findAssociatedTokenAddress(
      plan,
      w.usd,
      v1.TOKEN_PROGRAM_ID,
    );
    const authority = await v1.findSubscriptionAuthorityPda(
      w.owner.address,
      w.usd,
    );
    const rent = w.env.lamportsOf(plan) + w.env.lamportsOf(staging);
    const ownerLamports = w.env.lamportsOf(w.owner.address);
    expect(w.env.tokenDelegate(w.ownerUsd)).toBe(authority);
    const ixs = await closeIxs(w, plan);
    expect(ixs.map((ix) => ix.programAddress)).toEqual([
      v1.AROMA_GUARD_V1_PROGRAM_ID,
      v1.SUBSCRIPTIONS_PROGRAM_ID,
      v1.SUBSCRIPTIONS_PROGRAM_ID,
    ]);
    const r = await w.env.trySend(w.owner, ixs); // one transaction
    expect(r.ok, r.logs.join("\n")).toBe(true);
    expect(w.env.data(plan)).toBeNull();
    expect(w.env.data(staging)).toBeNull();
    expect(w.env.data(p.recurringDelegation)).toBeNull();
    expect(w.env.data(authority)).toBeNull();
    expect(w.env.tokenDelegate(w.ownerUsd)).toBeNull();
    // The owner paid only the fee (5,000 lamports) and received both rents (plan + staging),
    // plus the delegation's and authority's rent from upstream (the owner paid them).
    expect(
      w.env.lamportsOf(w.owner.address) - ownerLamports,
    ).toBeGreaterThanOrEqual(rent - 5_000n);
    expect(r.logs.some((l) => l.includes("Program data:"))).toBe(true); // PlanClosed event
  });

  test("a revoked delegation stops execution (fails closed in the Subscriptions check)", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan();
    const { getRevokeDelegationInstruction } =
      await import("@solana/subscriptions");
    await w.env.send(w.owner, [
      getRevokeDelegationInstruction({
        authority: w.owner,
        delegationAccount: w.plan(plan).recurringDelegation,
      }),
    ]);
    expect(errorCode((await w.execute(plan, 0, 1)).logs)).toBe(
      "InvalidSubscriptionAccount",
    );
  });
});

async function closeIxs(
  w: World,
  plan: Awaited<ReturnType<World["createPlan"]>>,
) {
  const p = w.plan(plan);
  return v1.buildCloseAndRevokeInstructions({
    owner: w.owner,
    planAddress: plan,
    plan: p,
    revokeAuthority: true,
  });
}
