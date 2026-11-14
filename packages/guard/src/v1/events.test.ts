import { generateKeyPairSigner } from "@solana/kit";
import { describe, expect, test } from "vitest";
import { AROMA_GUARD_V1_PROGRAM_ID } from "./constants";
import { decodeAromaGuardEvents, installmentEvents } from "./events";
import {
  getInstallmentExecutedEventEncoder,
  getPlanClosedEventEncoder,
  getPlanCreatedEventEncoder,
} from "./generated";

const b64 = (bytes: ArrayLike<number>) =>
  btoa(String.fromCharCode(...Array.from(bytes)));
const ID = AROMA_GUARD_V1_PROGRAM_ID;
const OTHER = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";

async function sample() {
  const plan = (await generateKeyPairSigner()).address;
  const mint = (await generateKeyPairSigner()).address;
  const installment = b64(
    getInstallmentExecutedEventEncoder().encode({
      plan,
      period: 2,
      legs: [
        {
          leg: 0,
          mint,
          amountIn: 10_000_000n,
          fee: 0n,
          amountOut: 4_321n,
          minOut: 4_200n,
          oraclePrice: 23_142_000_000n,
          oracleExpo: -8,
          oraclePublishTime: 1_763_000_000n,
          multiplierFp: 1_000_000_000_000n,
        },
      ],
      newlySkipped: 1,
      periodComplete: true,
    }),
  );
  return { plan, mint, installment };
}

describe("decodeAromaGuardEvents", () => {
  test("decodes events logged by the v1 program, with exact bigint amounts", async () => {
    const { plan, installment } = await sample();
    const created = b64(
      getPlanCreatedEventEncoder().encode({
        plan,
        owner: plan,
        fundingMint: plan,
        nonce: 1n,
        fundingAmount: 10_000_000n,
        periodSeconds: 604_800n,
        startsAt: 1n,
        expiresAt: 2n,
        periods: 4,
        outputs: 1,
      }),
    );
    const closed = b64(
      getPlanClosedEventEncoder().encode({
        plan,
        owner: plan,
        returnedAmount: 0n,
        executedPeriods: 1,
        skippedPeriods: 1,
      }),
    );
    const logs = [
      `Program ${ID} invoke [1]`,
      `Program ${OTHER} invoke [2]`,
      `Program ${OTHER} success`,
      `Program data: ${installment}`,
      `Program data: ${created}`,
      `Program data: ${closed}`,
      `Program ${ID} success`,
    ];
    const events = decodeAromaGuardEvents(logs);
    expect(events.map((e) => e.name)).toEqual([
      "InstallmentExecuted",
      "PlanCreated",
      "PlanClosed",
    ]);
    const [event] = installmentEvents(logs);
    expect(event!.period).toBe(2);
    expect(event!.newlySkipped).toBe(1);
    expect(event!.legs[0]!.amountOut).toBe(4_321n);
  });

  test("ignores data logged by any other program, including one invoked by v1", async () => {
    const { installment } = await sample();
    expect(
      decodeAromaGuardEvents([
        `Program ${OTHER} invoke [1]`,
        `Program data: ${installment}`,
        `Program ${OTHER} success`,
      ]),
    ).toEqual([]);
    expect(
      decodeAromaGuardEvents([
        `Program ${ID} invoke [1]`,
        `Program ${OTHER} invoke [2]`,
        `Program data: ${installment}`,
        `Program ${OTHER} failed: custom program error: 0x1`,
      ]),
    ).toEqual([]);
    // Outside any invocation (forged log line order).
    expect(decodeAromaGuardEvents([`Program data: ${installment}`])).toEqual(
      [],
    );
  });

  test("tolerates malformed, unknown and truncated data", async () => {
    const { installment } = await sample();
    expect(
      decodeAromaGuardEvents([
        `Program ${ID} invoke [1]`,
        "Program data: not base64!",
        `Program data: ${b64([1, 2, 3, 4, 5, 6, 7, 8, 9])}`,
        `Program data: ${installment.slice(0, 24)}`,
        `Program ${ID} success`,
      ]),
    ).toEqual([]);
    expect(decodeAromaGuardEvents(null)).toEqual([]);
  });
});
