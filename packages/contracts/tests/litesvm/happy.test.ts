/** Happy paths: 1 leg, N legs across transactions, fees, permissionless execution, value bound. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { address, generateKeyPairSigner } from "@solana/kit";
import * as v1 from "../../../../apps/web/lib/sdk/guard/v1";
import { ataIx, errorCode, evenWeights, World } from "./world";

describe("execute_installment happy paths (devnet-mock)", () => {
  test("one leg: pulls exactly the installment, mints the oracle amount, funds the treasury", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan({ amount: 30_000_000n, periods: 3 });
    const treasury = await v1.findAssociatedTokenAddress(
      w.treasury.address,
      w.usd,
      v1.TOKEN_PROGRAM_ID,
    );
    const staging = await v1.findAssociatedTokenAddress(
      plan,
      w.usd,
      v1.TOKEN_PROGRAM_ID,
    );
    const before = {
      owner: w.env.tokenAmount(w.ownerUsd),
      treasury: w.env.tokenAmount(treasury),
      staging: w.env.tokenAmount(staging),
    };
    const r = await w.execute(plan, 0, 0b1);
    expect(r.ok, r.logs.join("\n")).toBe(true);
    // $30 at $200.00000 per share, 8 dp, multiplier 1 → 0.15 shares.
    expect(w.env.tokenAmount(w.stocks[0]!.ownerAta)).toBe(15_000_000n);
    expect(before.owner - w.env.tokenAmount(w.ownerUsd)).toBe(30_000_000n);
    expect(w.env.tokenAmount(treasury) - before.treasury).toBe(30_000_000n);
    expect(w.env.tokenAmount(staging)).toBe(before.staging);
    const p = w.plan(plan);
    expect([
      p.executedPeriods,
      p.skippedPeriods,
      p.lastExecutedPeriod,
      p.legBitmap,
      p.inProgressPeriod,
    ]).toEqual([1, 0, 0, 0, v1.NO_PERIOD]);
    expect(
      r.logs.some((l) => l.includes("devnet-mock mint at oracle price")),
    ).toBe(true);
  });

  test("three legs across two transactions: the leg bitmap completes the period", async () => {
    const w = await World.create({ stocks: 3 });
    const plan = await w.createPlan({
      amount: 100_000_000n,
      weights: [5_000, 3_000, 2_000],
    });
    const first = await w.execute(plan, 0, 0b001);
    expect(first.ok, first.logs.join("\n")).toBe(true);
    let p = w.plan(plan);
    expect([p.legBitmap, p.inProgressPeriod, p.executedPeriods]).toEqual([
      0b001, 0, 0,
    ]);
    // The second transaction must name the in-flight period; another period is refused.
    expect(errorCode((await w.execute(plan, 1, 0b110)).logs)).toBe(
      "UnexpectedPeriod",
    );
    // A leg cannot run twice.
    expect(errorCode((await w.execute(plan, 0, 0b011)).logs)).toBe(
      "InvalidLegMask",
    );
    const second = await w.execute(plan, 0, 0b110);
    expect(second.ok, second.logs.join("\n")).toBe(true);
    p = w.plan(plan);
    expect([
      p.legBitmap,
      p.inProgressPeriod,
      p.executedPeriods,
      p.lastExecutedPeriod,
    ]).toEqual([0, v1.NO_PERIOD, 1, 0]);
    // $50 / $30 / $20 at $200 → 0.25 / 0.15 / 0.10 shares.
    expect(w.stocks.map((s) => w.env.tokenAmount(s.ownerAta))).toEqual([
      25_000_000n,
      15_000_000n,
      10_000_000n,
    ]);
  });

  test("all legs in one transaction, and the builder's batches cover every leg once", async () => {
    const w = await World.create({ stocks: 3 });
    const plan = await w.createPlan({ amount: 90_000_000n });
    const masks = v1.planLegBatches(3);
    expect(masks).toEqual([0b111]);
    expect(v1.planLegBatches(5, 2)).toEqual([0b00011, 0b01100, 0b10000]);
    const r = await w.execute(plan, 0, masks[0]!);
    expect(r.ok, r.logs.join("\n")).toBe(true);
    expect(w.plan(plan).executedPeriods).toBe(1);
  });

  test("protocol fee at a non-zero rate goes to the fee recipient; output is priced on the rest", async () => {
    const w = await World.create({ stocks: 1, feeBps: 25 });
    const plan = await w.createPlan({ amount: 40_000_000n });
    const fee = await v1.findAssociatedTokenAddress(
      w.feeRecipient.address,
      w.usd,
      v1.TOKEN_PROGRAM_ID,
    );
    const treasury = await v1.findAssociatedTokenAddress(
      w.treasury.address,
      w.usd,
      v1.TOKEN_PROGRAM_ID,
    );
    // A fee is configured, so the fee account is required.
    expect(
      errorCode((await w.execute(plan, 0, 0b1, { noFeeAccount: true })).logs),
    ).toBe("InvalidTokenAccount");
    const r = await w.execute(plan, 0, 0b1);
    expect(r.ok, r.logs.join("\n")).toBe(true);
    expect(w.env.tokenAmount(fee)).toBe(100_000n); // 0.25% of $40
    expect(w.env.tokenAmount(treasury)).toBe(39_900_000n);
    expect(w.env.tokenAmount(w.stocks[0]!.ownerAta)).toBe(19_950_000n); // $39.90 / $200
  });

  test("keeper_authority None: anyone can execute; Some(keeper): others are refused", async () => {
    const open = await World.create({ stocks: 1, anyoneCanExecute: true });
    const planA = await open.createPlan();
    const stranger = await open.env.signer();
    expect((await open.execute(planA, 0, 0b1, { keeper: stranger })).ok).toBe(
      true,
    );
    const gated = await World.create({ stocks: 1 });
    const planB = await gated.createPlan();
    const other = await gated.env.signer();
    expect(
      errorCode((await gated.execute(planB, 0, 0b1, { keeper: other })).logs),
    ).toBe("NotKeeper");
    expect((await gated.execute(planB, 0, 0b1)).ok).toBe(true);
  });

  test("no path mints more than the oracle value of the funding pulled", async () => {
    // Random prices, confidences, amounts, weights and multipliers; every leg is checked exactly:
    // minted × price × multiplier ≤ amount_in (all scaled to integers), and equals the TS mirror.
    let seed = 0x5eed;
    const rand = (n: number) => (
      (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31),
      seed % n
    );
    for (let round = 0; round < 6; round += 1) {
      const multipliers = [1, 1.0038023030588032, 1.0295541831890767].map(
        (m, i) => ((round + i) % 2 ? m : 1),
      );
      const w = await World.create({ stocks: 3, multipliers });
      const amount = BigInt(1_000_000 + rand(400_000_000));
      const weights = evenWeights(3);
      const plan = await w.createPlan({ amount, weights });
      const prices = [0, 1, 2].map(() => BigInt(100_000 + rand(90_000_000)));
      const updates = await w.postPrices(w.stocks, { prices, conf: 1n });
      const r = await w.execute(plan, 0, 0b111, { prices: updates });
      expect(r.ok, r.logs.join("\n")).toBe(true);
      const legs = v1.legAmounts(amount, weights);
      w.stocks.forEach((s, i) => {
        const minted = w.env.tokenAmount(s.ownerAta);
        const m = v1.multiplierFpCeil(multipliers[i]!);
        const expected = v1.expectedOut({
          amountIn: legs[i]!,
          fundingDecimals: 6,
          outputDecimals: 8,
          price: prices[i]!,
          expo: -5,
          multiplierFp: m,
        });
        expect(minted).toBe(expected);
        // value(minted) = minted/1e8 shares × m/1e12 × price/1e5 USD ≤ leg/1e6 USD
        expect(
          minted * m * prices[i]! <=
            (legs[i]! * 10n ** 8n * 10n ** 12n * 10n ** 5n) / 10n ** 6n,
        ).toBe(true);
      });
    }
  });
});

describe("real data", () => {
  const fixtures = path.resolve(import.meta.dirname, "../fixtures");

  test("a real receiver-written PriceUpdateV2 (devnet AAPL, Full) prices a leg", async () => {
    const { priceUpdates } = JSON.parse(
      fs.readFileSync(
        path.join(fixtures, "pyth-devnet-price-updates.json"),
        "utf8",
      ),
    ) as {
      priceUpdates: { symbol: string; address: string; dataBase64: string }[];
    };
    const aapl = priceUpdates.find((u) => u.symbol === "AAPL")!;
    const bytes = Buffer.from(aapl.dataBase64, "base64");
    const publishTime = bytes.readBigInt64LE(93);
    const w = await World.create({ stocks: 0 });
    w.env.setClock(publishTime + 5n);
    const feedId = new Uint8Array(bytes.subarray(41, 73));
    const mint = await w.mockMint(1);
    expect((await w.register(mint, feedId)).ok).toBe(true);
    const stock = {
      mint,
      feedId,
      decimals: 8,
      ownerAta: await v1.findAssociatedTokenAddress(
        w.owner.address,
        mint,
        v1.TOKEN_2022_PROGRAM_ID,
      ),
    };
    await w.env.send(w.owner, [ataIx(w.owner.address, mint)]);
    w.stocks.push(stock);
    const plan = await w.createPlan({
      amount: 301_810_020n,
      startsAt: w.env.now,
    });
    w.env.put(address(aapl.address), v1.PYTH_RECEIVER_PROGRAM_ID, bytes);
    const r = await w.execute(plan, 0, 0b1, {
      prices: [address(aapl.address)],
    });
    expect(r.ok, r.logs.join("\n")).toBe(true);
    // $301.81002 at $301.81002 per share → exactly 1 share.
    expect(w.env.tokenAmount(stock.ownerAta)).toBe(100_000_000n);
  });

  test("a stranger cannot sign as the keeper by passing the keeper's address", async () => {
    const w = await World.create({ stocks: 1 });
    const plan = await w.createPlan();
    const impostor = await generateKeyPairSigner();
    w.env.svm.airdrop(impostor.address, 1_000_000_000n as never);
    expect(
      errorCode((await w.execute(plan, 0, 0b1, { keeper: impostor })).logs),
    ).toBe("NotKeeper");
  });
});
