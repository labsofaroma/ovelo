/** Helpers for scripts/e2e-local.ts: local config, genesis price accounts, clock, assertions. */
import crypto from "node:crypto";
import type { Address } from "@solana/kit";
import * as v1 from "@ovelo/guard";

const DEFAULT = "11111111111111111111111111111111" as Address;
const four = (first?: Address) => [first ?? DEFAULT, DEFAULT, DEFAULT, DEFAULT];

/** The M6 decisions, with one local-only change: 1 hour of oracle staleness (genesis prices). */
export function e2eConfig(o: {
  admin: Address;
  keeper: Address;
  usd: Address;
  treasury: Address;
}): v1.ConfigParamsArgs {
  return {
    admin: o.admin,
    keeperAuthority: o.keeper,
    allowedFundingMints: four(o.usd),
    maxSlippageBps: 300,
    maxOracleStalenessS: 3_600,
    catchUpWindowPeriods: 1,
    protocolFeeBps: 0,
    feeRecipient: DEFAULT,
    maxInstallmentAmount: 500_000_000n,
    maxConfidenceBps: 200,
    treasury: o.treasury,
    allowedFreezeAuthorities: four(),
    allowedPermanentDelegates: four(),
    allowedTransferHookPrograms: four(),
  };
}

const DISCRIMINATOR = crypto
  .createHash("sha256")
  .update("account:PriceUpdateV2")
  .digest()
  .subarray(0, 8);

/** `solana account --output json` shape for a fully verified PriceUpdateV2 owned by the receiver. */
export function priceAccountJson(
  addr: Address,
  p: {
    feedId: Uint8Array;
    price: bigint;
    conf: bigint;
    expo: number;
    publishTime: bigint;
  },
): string {
  const data = Buffer.alloc(8 + 32 + 1 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8);
  let o = 0;
  DISCRIMINATOR.copy(data, o);
  o += 40;
  data[o++] = 1; // VerificationLevel::Full
  Buffer.from(p.feedId).copy(data, o);
  o += 32;
  o = data.writeBigInt64LE(p.price, o);
  o = data.writeBigUInt64LE(p.conf, o);
  o = data.writeInt32LE(p.expo, o);
  o = data.writeBigInt64LE(p.publishTime, o);
  o = data.writeBigInt64LE(p.publishTime - 1n, o);
  o = data.writeBigInt64LE(p.price, o);
  o = data.writeBigUInt64LE(p.conf, o);
  data.writeBigUInt64LE(1n, o);
  return JSON.stringify({
    pubkey: addr,
    account: {
      lamports: 10_000_000,
      data: [data.toString("base64"), "base64"],
      owner: v1.PYTH_RECEIVER_PROGRAM_ID,
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  });
}

type ClockReader = {
  getAccountInfo(
    a: Address,
    c: { encoding: "base64" },
  ): { send(): Promise<{ value: { data: [string, string] } | null }> };
};

/** The Clock sysvar's unix_timestamp (what the program sees). */
export async function readClock(rpc: ClockReader): Promise<bigint> {
  const info = (
    await rpc
      .getAccountInfo(
        "SysvarC1ock11111111111111111111111111111111" as Address,
        { encoding: "base64" },
      )
      .send()
  ).value;
  if (!info) throw new Error("Clock sysvar missing");
  return Buffer.from(info.data[0], "base64").readBigInt64LE(32);
}

export async function waitForClock(
  rpc: ClockReader,
  target: bigint,
): Promise<void> {
  while ((await readClock(rpc)) < target)
    await new Promise((r) => setTimeout(r, 500));
}

export type Leg = {
  period: number;
  symbol: string;
  amountIn: bigint;
  minted: bigint;
  price: bigint;
  multiplier: number;
};

/** Assertions. Rounding stated: minted = floor(exact oracle amount), so 0 ≤ exact − minted < 1 raw unit. */
export function report(r: {
  plan: v1.Plan;
  legs: Leg[];
  treasuryReceived: bigint;
  expectedTreasury: bigint;
  planGone: boolean;
  stagingGone: boolean;
  delegationGone: boolean;
  authorityGone: boolean;
  ownerDelegateRemoved: boolean;
  ownerLamportsDelta: bigint;
  rentBack: bigint;
}) {
  const legs = r.legs.map((leg) => {
    const m = v1.multiplierFpCeil(leg.multiplier);
    const expected = v1.expectedOut({
      amountIn: leg.amountIn,
      fundingDecimals: 6,
      outputDecimals: 8,
      price: leg.price,
      expo: -5,
      multiplierFp: m,
    });
    // exact = amountIn × 10^19 / (price × m); minted must equal its floor.
    const num = leg.amountIn * 10n ** 19n;
    const den = leg.price * m;
    const withinRounding =
      leg.minted * den <= num && num < (leg.minted + 1n) * den;
    return {
      ...leg,
      expected,
      equalsOracleFloor: leg.minted === expected && withinRounding,
    };
  });
  const checks = {
    executedPeriods3: r.plan.executedPeriods === 3,
    skippedPeriods1: r.plan.skippedPeriods === 1,
    lastExecutedPeriod3: r.plan.lastExecutedPeriod === 3,
    mintedEqualsOracleFloor: legs.every((l) => l.equalsOracleFloor),
    treasuryReceivedAllFunding: r.treasuryReceived === r.expectedTreasury,
    planClosed: r.planGone,
    stagingClosed: r.stagingGone,
    delegationGone: r.delegationGone,
    subscriptionAuthorityGone: r.authorityGone,
    ownerTokenDelegateRemoved: r.ownerDelegateRemoved,
    rentReturnedToOwner: r.ownerLamportsDelta >= r.rentBack - 10_000n,
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    rentBack: r.rentBack,
    ownerLamportsDelta: r.ownerLamportsDelta,
    treasuryReceived: r.treasuryReceived,
    legs,
  };
}
