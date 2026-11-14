/** Every refusal path the program owns, each with its error code. */
import { describe, expect, test } from "vitest";
import {
  generateKeyPairSigner,
  type Address,
  type Instruction,
} from "@solana/kit";
import * as v1 from "@aroma/guard";
import { getCreatePlanInstructionDataEncoder } from "@aroma/guard/generated";
import { ataIx, errorCode, World } from "./world";

/** Index of the first remaining account in `execute_installment` (13 fixed accounts). */
const FIXED = 13;

function replaceAccount(
  ixs: Instruction[],
  index: number,
  addr: Address,
): Instruction[] {
  const ix = ixs[ixs.length - 1]!;
  const accounts = [...(ix.accounts ?? [])];
  accounts[index] = { ...accounts[index]!, address: addr };
  return [...ixs.slice(0, -1), { ...ix, accounts }];
}

/** Rewrites the create_plan data, bypassing the client-side checks, to test the program's own. */
async function rawCreate(
  w: World,
  args: { amount?: bigint; weights?: number[]; slippage?: number },
) {
  const ixs = await w.createPlanIxs({ amount: args.amount ?? 30_000_000n });
  const last = ixs[ixs.length - 1]!;
  const data = getCreatePlanInstructionDataEncoder().encode({
    nonce: 1n,
    fundingAmount: args.amount ?? 30_000_000n,
    periodSeconds: 86_400n,
    startsAt: w.env.now,
    periods: 4,
    outputs: w.stocks.map((s, i) => ({
      mint: s.mint,
      weightBps: args.weights?.[i] ?? [3_334, 3_333, 3_333][i]!,
      maxSlippageBps: args.slippage ?? 100,
    })),
  });
  return w.env.trySend(w.owner, [...ixs.slice(0, -1), { ...last, data }]);
}

describe("oracle", () => {
  const cases: [string, Parameters<World["postPrices"]>[1], string][] = [
    [
      "stale price (61 s old, max 60)",
      { publishTime: 1_799_999_939n },
      "StalePrice",
    ],
    ["wide confidence (2.01% > 2%)", { conf: 402_001n }, "ConfidenceTooWide"],
    ["partially verified update", { full: false }, "PriceNotFullyVerified"],
    [
      "another asset's feed",
      { feedId: new Uint8Array(32).fill(7) },
      "PriceFeedMismatch",
    ],
    ["non-positive price", { price: 0n }, "NonPositivePrice"],
  ];
  for (const [name, price, code] of cases) {
    test(name, async () => {
      const w = await World.create({ stocks: 1 });
      const plan = await w.createPlan();
      const prices = await w.postPrices(w.stocks, price);
      expect(errorCode((await w.execute(plan, 0, 1, { prices })).logs)).toBe(
        code,
      );
      // Nothing moved: the pull rolled back with the failed leg.
      expect(w.plan(plan).inProgressPeriod).toBe(v1.NO_PERIOD);
    });
  }

  test("an account not owned by the Pyth receiver", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan();
    const [real] = await w.postPrices(w.stocks);
    const fake = (await generateKeyPairSigner()).address;
    w.env.put(fake, w.owner.address, w.env.data(real!)!);
    expect(
      errorCode((await w.execute(plan, 0, 1, { prices: [fake] })).logs),
    ).toBe("InvalidPriceAccount");
  });

  test("a price so high that the leg would receive nothing", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan({ amount: 1n });
    const prices = await w.postPrices(w.stocks, {
      price: 9_000_000_000_000_000n,
      conf: 0n,
    });
    expect(errorCode((await w.execute(plan, 0, 1, { prices })).logs)).toBe(
      "ZeroOutput",
    );
  });
});

describe("registry and plan terms", () => {
  test("an unregistered output mint is refused at creation", async () => {
    const w = await World.create({ stocks: 1 });
    const loose = await w.mockMint(1); // created but never registered
    const stock = { ...w.stocks[0]!, mint: loose };
    const r = await w.env.trySend(
      w.owner,
      await w.createPlanIxs({ stocks: [stock] }),
    );
    expect(errorCode(r.logs)).toBe("AssetMismatch");
  });

  test("a disabled asset is refused at creation and at execution", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan({ nonce: 1n });
    await w.env.send(w.admin, [
      await v1.buildSetAssetEnabledInstruction(
        w.admin,
        w.stocks[0]!.mint,
        false,
      ),
    ]);
    expect(errorCode((await w.execute(plan, 0, 1)).logs)).toBe("AssetDisabled");
    const r = await w.env.trySend(
      w.owner,
      await w.createPlanIxs({ nonce: 2n, initId: await w.authorityInitId() }),
    );
    expect(errorCode(r.logs)).toBe("AssetDisabled");
    await w.env.send(w.admin, [
      await v1.buildSetAssetEnabledInstruction(
        w.admin,
        w.stocks[0]!.mint,
        true,
      ),
    ]);
    expect((await w.execute(plan, 0, 1)).ok).toBe(true);
  });

  test("a funding mint that is not allow-listed", async () => {
    const w = await World.create({ stocks: 1 });
    const other = (await generateKeyPairSigner()).address;
    w.env.classicMint(other, 6, w.admin.address);
    await w.env.classicAta(w.owner.address, other, 1_000_000_000n);
    const ixs = await v1.buildCreatePlanInstructions({
      owner: w.owner,
      fundingMint: other,
      fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
      nonce: 1n,
      fundingAmount: 10_000_000n,
      periodSeconds: 86_400n,
      startsAt: w.env.now,
      periods: 2,
      outputs: [
        { mint: w.stocks[0]!.mint, weightBps: 10_000, maxSlippageBps: 0 },
      ],
      catchUpWindowPeriods: 1,
      subscriptionAuthorityInitId: null,
    });
    expect(errorCode((await w.env.trySend(w.owner, ixs)).logs)).toBe(
      "FundingMintNotAllowed",
    );
  });

  test("weights that do not sum to 10,000 bps (program check, client bypassed)", async () => {
    const w = await World.create({ stocks: 3 });
    expect(
      errorCode((await rawCreate(w, { weights: [3_334, 3_333, 3_332] })).logs),
    ).toBe("InvalidWeights");
    expect(() =>
      v1.assertPlanParams({
        ...baseParams(w),
        outputs: [
          { mint: w.stocks[0]!.mint, weightBps: 9_999, maxSlippageBps: 0 },
        ],
      }),
    ).toThrow(/10,000/);
  });

  test("an installment above the launch cap, and slippage above the cap", async () => {
    const w = await World.create({ stocks: 3, maxInstallment: 50_000_000n });
    expect(errorCode((await rawCreate(w, { amount: 50_000_001n })).logs)).toBe(
      "AmountAboveCap",
    );
    expect(errorCode((await rawCreate(w, { slippage: 301 })).logs)).toBe(
      "SlippageAboveCap",
    );
    expect((await rawCreate(w, { amount: 50_000_000n })).ok).toBe(true);
  });

  test("delegation terms that do not match the window are refused (typed Subscriptions check)", async () => {
    const w = await World.create({ stocks: 1, window: 1 });
    const ixs = await v1.buildCreatePlanInstructions({
      ...baseParams(w),
      catchUpWindowPeriods: 0,
    });
    expect(errorCode((await w.env.trySend(w.owner, ixs)).logs)).toBe(
      "DelegationTermsMismatch",
    );
  });
});

describe("execution accounts", () => {
  test("a destination that is not the owner's associated token account", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan();
    await w.env.send(w.keeper, [ataIx(w.keeper.address, w.stocks[0]!.mint)]);
    const keeperAta = await v1.findAssociatedTokenAddress(
      w.keeper.address,
      w.stocks[0]!.mint,
      v1.TOKEN_2022_PROGRAM_ID,
    );
    const ixs = replaceAccount(
      await w.executeIxs(plan, 0, 1),
      FIXED + 2,
      keeperAta,
    );
    expect(errorCode((await w.env.trySend(w.keeper, ixs)).logs)).toBe(
      "WrongDestination",
    );
  });

  test("another asset's registry account for a leg", async () => {
    const w = await World.create({ stocks: 2 });
    const plan = await w.createPlan({
      stocks: [w.stocks[0]!],
      weights: [10_000],
    });
    const wrongAsset = await v1.findAssetPda(w.stocks[1]!.mint);
    const ixs = replaceAccount(
      await w.executeIxs(plan, 0, 1, { stocks: [w.stocks[0]!] }),
      FIXED,
      wrongAsset,
    );
    expect(errorCode((await w.env.trySend(w.keeper, ixs)).logs)).toBe(
      "AssetMismatch",
    );
  });

  test("a mock mint authority that is not the asset's PDA", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan();
    const ixs = replaceAccount(
      await w.executeIxs(plan, 0, 1),
      FIXED + 4,
      w.keeper.address,
    );
    expect(errorCode((await w.env.trySend(w.keeper, ixs)).logs)).toBe(
      "MockMintAuthorityMismatch",
    );
  });

  test("leg masks: empty, out of range, and missing leg accounts", async () => {
    const w = await World.create({ stocks: 2 });
    const plan = await w.createPlan();
    const ok = await w.executeIxs(plan, 0, 0b01);
    const withMask = (mask: number) => {
      const ix = ok[1]!;
      const data = new Uint8Array(ix.data!);
      new DataView(data.buffer).setUint32(10, mask, true); // disc(8) + period u16
      return [ok[0]!, { ...ix, data }];
    };
    expect(errorCode((await w.env.trySend(w.keeper, withMask(0))).logs)).toBe(
      "InvalidLegMask",
    );
    expect(
      errorCode((await w.env.trySend(w.keeper, withMask(0b100))).logs),
    ).toBe("InvalidLegMask");
    expect(
      errorCode((await w.env.trySend(w.keeper, withMask(0b11))).logs),
    ).toBe("InvalidRemainingAccounts");
  });
});

function baseParams(w: World): v1.CreatePlanParams {
  return {
    owner: w.owner,
    fundingMint: w.usd,
    fundingTokenProgram: v1.TOKEN_PROGRAM_ID,
    nonce: 1n,
    fundingAmount: 10_000_000n,
    periodSeconds: 86_400n,
    startsAt: w.env.now,
    periods: 2,
    outputs: [
      { mint: w.stocks[0]!.mint, weightBps: 10_000, maxSlippageBps: 0 },
    ],
    catchUpWindowPeriods: 1,
    subscriptionAuthorityInitId: null,
  };
}
