import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import {
  findSubscriptionAuthorityPda,
  planAddresses,
  SUBSCRIPTIONS_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  V1_PROGRAM_ID,
} from "@aroma/guard";
import { getSubscriptionAuthorityEncoder } from "@solana/subscriptions";
import { describe, expect, it } from "vitest";
import { createKeyring } from "@/server/auth/trade";
import { openPlanAuthorization } from "@/server/auth/plan";
import { memoryInvestStore } from "./store";
import { planAccount, world } from "./test-world";
import { prepareClose, prepareCreate, type PrepareDeps } from "./prepare";

const keyring = createKeyring("k".repeat(40));
const NOW = 1_763_100_000_000;

async function deps(
  w: Awaited<ReturnType<typeof world>>,
  baskets = [] as Awaited<ReturnType<PrepareDeps["baskets"]>>,
) {
  return {
    network: w.network,
    rpc: w.chain.rpc,
    keyring,
    store: memoryInvestStore(),
    baskets: async () => baskets,
    now: () => NOW,
  } satisfies PrepareDeps;
}

function programs(transaction: string): string[] {
  const tx = getTransactionDecoder().decode(
    getBase64Encoder().encode(transaction),
  );
  const message = getCompiledTransactionMessageDecoder().decode(
    tx.messageBytes,
  );
  return ("instructions" in message ? message.instructions : []).map(
    (ix) => message.staticAccounts[ix.programAddressIndex]!,
  );
}

const request = (
  owner: string,
  outputs: { mint: string; weightBps: number }[],
) => ({
  owner,
  fundingAmount: "10000000",
  periodSeconds: 604_800,
  periods: 4,
  selection: { kind: "assets" as const, outputs },
});

describe("prepareCreate", () => {
  it("one simulated transaction: Subscriptions authority, delegation, then create_plan; plain-words approval", async () => {
    const w = await world();
    const result = await prepareCreate(
      await deps(w),
      request(w.owner.address, [
        { mint: w.aapl.address, weightBps: 5_000 },
        { mint: w.msft.address, weightBps: 5_000 },
      ]),
    );
    expect(programs(result.transaction)).toEqual([
      SUBSCRIPTIONS_PROGRAM_ID,
      SUBSCRIPTIONS_PROGRAM_ID,
      V1_PROGRAM_ID,
    ]);
    expect(w.chain.calls.some((c) => c.method === "simulateTransaction")).toBe(
      true,
    );
    const payload = openPlanAuthorization(result.authorization, keyring, {
      now: NOW,
    });
    expect(payload).toMatchObject({
      kind: "plan_create",
      owner: w.owner.address,
      plan: result.plan,
      cluster: "devnet",
    });
    expect(payload.receipt).toMatchObject({
      installmentRaw: "10000000",
      periods: 4,
      nonce: "1",
    });
    expect(result.summary.label).toBe("Devnet: test tokens, no real value");
    expect(result.summary.approval).toMatchObject({
      installmentRaw: "10000000",
      allowancePerPeriodRaw: "20000000",
      catchUpWindowPeriods: 1,
    });
    expect(result.summary.approval.text).toMatch(/up to 20 tUSD per period/);
    expect(result.summary.approval.text).toMatch(
      /at most one installment of 10 tUSD per period/,
    );
    expect(result.summary.title).toBe(
      "Invest 10 tUSD every week into AAPL 50% · MSFT 50%",
    );
    expect(result.summary.lines.join(" ")).toMatch(/balance now: 250 tUSD/);
    expect(result.summary.risk).toMatch(/no real value/);
  });

  it("skips the authority instruction when the owner already has one, and picks a fresh nonce", async () => {
    const w = await world();
    const d = await deps(w);
    await d.store.upsertRows([
      {
        pda: "x",
        owner: w.owner.address,
        fundingMint: w.usd.address,
        nonce: "6",
        status: "closed",
        nextDueAt: null,
        lastPeriod: null,
        skippedPeriods: 0,
        executedPeriods: 0,
        periods: 1,
      },
    ]);
    w.chain.accounts.set(
      await findSubscriptionAuthorityPda(w.owner.address, w.usd.address),
      {
        owner: SUBSCRIPTIONS_PROGRAM_ID,
        data: Uint8Array.from(
          getSubscriptionAuthorityEncoder().encode({
            discriminator: 0,
            user: w.owner.address,
            tokenMint: w.usd.address,
            payer: w.owner.address,
            bump: 255,
            initId: 42n,
          }),
        ),
      },
    );
    const result = await prepareCreate(
      d,
      request(w.owner.address, [{ mint: w.aapl.address, weightBps: 10_000 }]),
    );
    expect(programs(result.transaction)).toEqual([
      SUBSCRIPTIONS_PROGRAM_ID,
      V1_PROGRAM_ID,
    ]);
    expect(
      openPlanAuthorization(result.authorization, keyring, { now: NOW }).receipt
        .nonce,
    ).toBe("7");
  });

  it("offers a basket only when every constituent is registered, at the basket's own weights", async () => {
    const w = await world();
    const d = await deps(w, [
      {
        id: "two",
        name: "Two",
        kind: "curated",
        members: [
          { symbol: "AAPLx", weightBps: 6_000 },
          { symbol: "MSFTx", weightBps: 4_000 },
        ],
      },
      {
        id: "mag7",
        name: "Mag 7",
        kind: "curated",
        members: [
          { symbol: "AAPLx", weightBps: 5_000 },
          { symbol: "TSLAx", weightBps: 5_000 },
        ],
      },
    ]);
    const ok = await prepareCreate(d, {
      ...request(w.owner.address, []),
      selection: { kind: "basket", basketId: "two" },
    });
    expect(
      openPlanAuthorization(ok.authorization, keyring, {
        now: NOW,
      }).receipt.outputs.map((o) => o.weightBps),
    ).toEqual([6_000, 4_000]);
    await expect(
      prepareCreate(d, {
        ...request(w.owner.address, []),
        selection: { kind: "basket", basketId: "mag7" },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      publicMessage: expect.stringMatching(/TSLA is not registered/),
    });
    await expect(
      prepareCreate(d, {
        ...request(w.owner.address, []),
        selection: { kind: "basket", basketId: "none" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("mirrors the program's refusals before anything is signed", async () => {
    const w = await world();
    const d = await deps(w);
    const aapl = [{ mint: w.aapl.address, weightBps: 10_000 }];
    await expect(
      prepareCreate(d, {
        ...request(w.owner.address, aapl),
        periodSeconds: 3_600,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      prepareCreate(d, {
        ...request(w.owner.address, aapl),
        fundingAmount: "600000000",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      prepareCreate(
        d,
        request(w.owner.address, [{ mint: w.aapl.address, weightBps: 9_000 }]),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      prepareCreate(
        d,
        request(w.owner.address, [{ mint: w.usd.address, weightBps: 10_000 }]),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      prepareCreate(d, {
        ...request(w.owner.address, [
          { mint: w.aapl.address, weightBps: 5_000 },
          { mint: w.msft.address, weightBps: 5_000 },
        ]),
        fundingAmount: "1",
      }),
    ).rejects.toMatchObject({
      publicMessage: expect.stringMatching(/too small/),
    });
    const paused = await world({ paused: true });
    await expect(
      prepareCreate(
        await deps(paused),
        request(paused.owner.address, [
          { mint: paused.aapl.address, weightBps: 10_000 },
        ]),
      ),
    ).rejects.toMatchObject({ code: "INVEST_UNAVAILABLE" });
  });

  it("devnet accepts the 15-minute test period only in a test build, and no other short period", async () => {
    const w = await world();
    expect(w.network.cluster).toBe("devnet");
    const aapl = [{ mint: w.aapl.address, weightBps: 10_000 }];
    const short = { ...request(w.owner.address, aapl), periodSeconds: 900 };
    await expect(prepareCreate(await deps(w), short)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      publicMessage: "Choose every day, every week or every 30 days.",
    });
    const test = await deps(w);
    const testBuild = {
      ...test,
      network: { ...test.network, testPeriods: true },
    };
    const prepared = await prepareCreate(testBuild, short);
    expect(prepared.transaction).toEqual(expect.any(String));
    await expect(
      prepareCreate(testBuild, { ...short, periodSeconds: 60 }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("needs the owner's test USD account, and never returns a transaction that fails simulation", async () => {
    const w = await world();
    w.chain.accounts.delete(w.ownerUsd);
    await expect(
      prepareCreate(
        await deps(w),
        request(w.owner.address, [{ mint: w.aapl.address, weightBps: 10_000 }]),
      ),
    ).rejects.toMatchObject({
      publicMessage: expect.stringMatching(/faucet/),
    });
    const v = await world();
    v.chain.simulation = {
      err: { InstructionError: [2, { Custom: 1 }] },
      logs: ["Program log: insufficient lamports"],
      unitsConsumed: 1,
    };
    await expect(
      prepareCreate(
        await deps(v),
        request(v.owner.address, [{ mint: v.aapl.address, weightBps: 10_000 }]),
      ),
    ).rejects.toMatchObject({
      code: "SIMULATION_FAILED",
      publicMessage: expect.stringMatching(/devnet SOL/),
    });
  });
});

describe("prepareClose", () => {
  it("close + revoke in one transaction; the last plan for the mint also revokes the authority", async () => {
    const w = await world();
    const { plan: pda } = await planAddresses({
      owner: w.owner.address,
      fundingMint: w.usd.address,
      fundingTokenProgram: TOKEN_PROGRAM_ID,
      nonce: 1n,
    });
    w.chain.accounts.set(
      pda,
      planAccount({
        owner: w.owner.address,
        fundingMint: w.usd.address,
        outputs: [
          { mint: w.aapl.address, weightBps: 10_000, maxSlippageBps: 100 },
        ],
        executedPeriods: 2,
        skippedPeriods: 1,
      }),
    );
    const result = await prepareClose(
      await deps(w),
      pda as never,
      w.owner.address,
    );
    expect(programs(result.transaction)).toEqual([
      V1_PROGRAM_ID,
      SUBSCRIPTIONS_PROGRAM_ID,
      SUBSCRIPTIONS_PROGRAM_ID,
    ]);
    expect(result.summary.lines[0]).toBe(
      "Executed 2 of 4 installments; 1 skipped.",
    );
    expect(result.summary.lines.join(" ")).toMatch(
      /token-account approval is removed/,
    );
    expect(
      openPlanAuthorization(result.authorization, keyring, { now: NOW }).kind,
    ).toBe("plan_close");
  });

  it("refuses a plan that is not on chain or not the caller's", async () => {
    const w = await world();
    const pda = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    await expect(
      prepareClose(await deps(w), pda as never, w.owner.address),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    w.chain.accounts.set(
      pda,
      planAccount({
        owner: w.keeper.address,
        fundingMint: w.usd.address,
        outputs: [
          { mint: w.aapl.address, weightBps: 10_000, maxSlippageBps: 100 },
        ],
      }),
    );
    await expect(
      prepareClose(await deps(w), pda as never, w.owner.address),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
