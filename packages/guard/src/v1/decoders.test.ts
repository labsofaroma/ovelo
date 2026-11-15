import { describe, expect, test } from "vitest";
import { getAssetEncoder, getConfigEncoder, getPlanEncoder } from "./generated";
import { NO_PERIOD } from "./constants";
import {
  decodeAssetAccount,
  decodeConfigAccount,
  decodePlanAccount,
  viewPlan,
} from "./decoders";
import { V1_DEPLOYMENTS, V1_PROGRAM_ID } from "./deployments";
import { OVELO_GUARD_V1_PROGRAM_ID } from "./constants";
import { k, plan } from "./test/fixtures";

const DAY = 86_400n;
const encodePlan = (overrides = {}) => getPlanEncoder().encode(plan(overrides));

describe("checked decoders", () => {
  test("a plan round-trips and is refused with a wrong discriminator or version", () => {
    const bytes = encodePlan();
    expect(decodePlanAccount(bytes).nonce).toBe(7n);
    const bad = new Uint8Array(bytes);
    bad[0] = bad[0]! ^ 1;
    expect(() => decodePlanAccount(bad)).toThrow(/Not an Ovelo Guard v1 plan/);
    expect(() => decodePlanAccount(encodePlan({ version: 2 }))).toThrow(
      /version 2/,
    );
    expect(() => decodePlanAccount(new Uint8Array(4))).toThrow(
      /Not an Ovelo Guard v1/,
    );
  });

  test("config and asset", () => {
    const four = [k(0), k(0), k(0), k(0)];
    const config = getConfigEncoder().encode({
      version: 1,
      admin: k(1),
      keeperAuthority: null,
      paused: false,
      allowedFundingMints: four,
      maxSlippageBps: 300,
      maxOracleStalenessS: 60,
      catchUpWindowPeriods: 1,
      protocolFeeBps: 0,
      feeRecipient: k(0),
      maxInstallmentAmount: 1n,
      bump: 255,
      maxConfidenceBps: 200,
      treasury: k(2),
      allowedFreezeAuthorities: four,
      allowedPermanentDelegates: four,
      allowedTransferHookPrograms: four,
      reserved: new Uint8Array(128),
    });
    expect(decodeConfigAccount(config).admin).toBe(k(1));
    expect(() => decodeAssetAccount(config)).toThrow(/asset/);
    const asset = getAssetEncoder().encode({
      version: 1,
      mint: k(4),
      tokenProgram: k(0),
      pythFeedId: new Uint8Array(32),
      decimals: 8,
      enabled: true,
      bump: 1,
      extensions: 0n,
      scaledUiAmount: true,
      mockMintBump: 2,
      registeredAt: 0n,
      reserved: new Uint8Array(64),
    });
    expect(decodeAssetAccount(asset).scaledUiAmount).toBe(true);
  });
});

describe("plan view", () => {
  test("waiting before the start, due at the start", () => {
    expect(viewPlan(k(7), plan(), 999n).status).toBe("waiting");
    expect(viewPlan(k(7), plan(), 1_000n)).toMatchObject({
      status: "due",
      due: { period: 0, newlySkipped: 0 },
    });
  });

  test("paused and in progress take precedence", () => {
    expect(viewPlan(k(7), plan({ pausedByOwner: true }), 1_000n).status).toBe(
      "paused",
    );
    const v = viewPlan(
      k(7),
      plan({ legBitmap: 0b001, inProgressPeriod: 2 }),
      1_000n + 5n * DAY,
    );
    expect(v).toMatchObject({
      status: "in_progress",
      due: { period: 2, newlySkipped: 0 },
    });
  });

  test("periods that can no longer run count as skipped, and the plan finishes", () => {
    const late = viewPlan(
      k(7),
      plan({ lastExecutedPeriod: 0, executedPeriods: 1 }),
      1_000n + 3n * DAY,
    );
    expect(late).toMatchObject({
      status: "due",
      due: { period: 2, newlySkipped: 1 },
      skippedIncludingPending: 1,
    });
    const lost = viewPlan(
      k(7),
      plan({ lastExecutedPeriod: 1, executedPeriods: 2 }),
      1_000n + 9n * DAY,
    );
    expect(lost).toMatchObject({
      status: "finished",
      due: null,
      skippedIncludingPending: 2,
    });
    const done = viewPlan(
      k(7),
      plan({ lastExecutedPeriod: 3, executedPeriods: 4 }),
      1_000n + 4n * DAY,
    );
    expect(done.status).toBe("finished");
    expect(
      viewPlan(
        k(7),
        plan({ lastExecutedPeriod: 0, executedPeriods: 1 }),
        1_000n + 10n,
      ).status,
    ).toBe("waiting");
    expect(NO_PERIOD).toBe(0xffff);
  });
});

test("devnet is recorded (M6); mainnet is not deployed until M10", () => {
  expect(V1_DEPLOYMENTS.devnet?.programId).toBe(V1_PROGRAM_ID);
  expect(V1_DEPLOYMENTS.mainnet).toBeNull();
  expect(V1_PROGRAM_ID).toBe(OVELO_GUARD_V1_PROGRAM_ID);
});
