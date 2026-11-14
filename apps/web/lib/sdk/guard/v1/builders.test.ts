import { describe, expect, test } from "vitest";
import {
  AccountRole,
  compileTransactionMessage,
  createNoopSigner,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import {
  parseCreateRecurringDelegationInstruction,
  UNKNOWN_INIT_ID,
  type CreateRecurringDelegationInstruction,
} from "@solana/subscriptions";
import {
  parseCreatePlanInstruction,
  parseExecuteInstallmentInstruction,
  type CreatePlanInstruction,
  type ExecuteInstallmentInstruction,
} from "./generated";
import {
  AROMA_GUARD_V1_PROGRAM_ID,
  SUBSCRIPTIONS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants";
import {
  assertPlanParams,
  buildCloseAndRevokeInstructions,
  buildCreatePlanInstructions,
  singleTransactionMessage,
  type CreatePlanParams,
} from "./builders";
import {
  buildInitializeConfigInstruction,
  buildRegisterAssetInstruction,
  buildSetAssetEnabledInstruction,
  buildSetPausedInstruction,
  buildUpdateConfigInstruction,
} from "./admin";
import { buildExecuteInstallmentInstruction, planLegBatches } from "./execute";
import {
  findAssetPda,
  findAssociatedTokenAddress,
  findPlanPda,
  findProgramDataAddress,
  planAddresses,
} from "./pdas";
import { k, owner, plan, stocks, usd } from "./test/fixtures";

const params = (
  overrides: Partial<CreatePlanParams> = {},
): CreatePlanParams => ({
  owner,
  fundingMint: usd,
  fundingTokenProgram: TOKEN_PROGRAM_ID,
  nonce: 7n,
  fundingAmount: 30_000_000n,
  periodSeconds: 86_400n,
  startsAt: 1_000n,
  periods: 4,
  outputs: stocks.map((mint, i) => ({
    mint,
    weightBps: [3_334, 3_333, 3_333][i]!,
    maxSlippageBps: 100,
  })),
  catchUpWindowPeriods: 1,
  subscriptionAuthorityInitId: null,
  ...overrides,
});

describe("create plan", () => {
  test("first plan for a mint: authority init, delegation with the required terms, create_plan", async () => {
    const ixs = await buildCreatePlanInstructions(params());
    expect(ixs.map((ix) => ix.programAddress)).toEqual([
      SUBSCRIPTIONS_PROGRAM_ID,
      SUBSCRIPTIONS_PROGRAM_ID,
      AROMA_GUARD_V1_PROGRAM_ID,
    ]);
    const delegation = parseCreateRecurringDelegationInstruction(
      ixs[1] as CreateRecurringDelegationInstruction,
    );
    const planPda = await findPlanPda(owner.address, usd, 7n);
    expect(delegation.accounts.delegatee.address).toBe(planPda);
    expect(delegation.data.recurringDelegation).toMatchObject({
      nonce: 7n,
      amountPerPeriod: 60_000_000n,
      periodLengthS: 86_400n,
      startTs: 1_000n,
      expiryTs: 1_000n + 5n * 86_400n,
      expectedSubscriptionAuthorityInitId: UNKNOWN_INIT_ID,
    });
    const create = parseCreatePlanInstruction(ixs[2] as CreatePlanInstruction);
    expect(create.accounts.plan.address).toBe(planPda);
    const remaining = (ixs[2]!.accounts ?? []).slice(-3);
    expect(remaining).toEqual(
      await Promise.all(
        stocks.map(async (m) => ({
          address: await findAssetPda(m),
          role: AccountRole.READONLY,
        })),
      ),
    );
  });

  test("later plans reuse the authority with its init id", async () => {
    const ixs = await buildCreatePlanInstructions(
      params({ subscriptionAuthorityInitId: 42n, catchUpWindowPeriods: 0 }),
    );
    expect(ixs).toHaveLength(2);
    const d = parseCreateRecurringDelegationInstruction(
      ixs[0] as CreateRecurringDelegationInstruction,
    ).data.recurringDelegation;
    expect([
      d.expectedSubscriptionAuthorityInitId,
      d.amountPerPeriod,
      d.expiryTs,
    ]).toEqual([42n, 30_000_000n, 1_000n + 4n * 86_400n]);
  });

  test("client-side checks mirror the program", () => {
    const one = (weightBps: number, mint = stocks[0]!) => [
      { mint, weightBps, maxSlippageBps: 0 },
    ];
    expect(() => assertPlanParams(params({ fundingAmount: 0n }))).toThrow(
      /positive/,
    );
    expect(() => assertPlanParams(params({ periods: 0 }))).toThrow(/period/);
    expect(() => assertPlanParams(params({ outputs: [] }))).toThrow(/1 to 20/);
    expect(() => assertPlanParams(params({ outputs: one(9_999) }))).toThrow(
      /10,000/,
    );
    expect(() =>
      assertPlanParams(params({ outputs: one(10_000, usd) })),
    ).toThrow(/distinct/);
    expect(() =>
      assertPlanParams(
        params({
          fundingAmount: 9_999n,
          outputs: [
            ...one(1),
            { mint: stocks[1]!, weightBps: 9_999, maxSlippageBps: 0 },
          ],
        }),
      ),
    ).toThrow(/Every asset/);
  });
});

describe("close + revoke", () => {
  const blockhash = {
    blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" as Blockhash,
    lastValidBlockHeight: 1n,
  };

  test("close and the Subscriptions revoke compile into ONE transaction", async () => {
    const p = plan();
    const planAddress = await findPlanPda(owner.address, usd, 7n);
    const ixs = await buildCloseAndRevokeInstructions({
      owner,
      planAddress,
      plan: p,
      revokeAuthority: true,
    });
    expect(ixs.map((ix) => ix.programAddress)).toEqual([
      AROMA_GUARD_V1_PROGRAM_ID,
      SUBSCRIPTIONS_PROGRAM_ID,
      SUBSCRIPTIONS_PROGRAM_ID,
    ]);
    const message = compileTransactionMessage(
      singleTransactionMessage(owner, blockhash, ixs),
    );
    expect(message.instructions).toHaveLength(3);
    const two = await buildCloseAndRevokeInstructions({
      owner,
      planAddress,
      plan: p,
      revokeAuthority: false,
    });
    expect(two.map((ix) => ix.programAddress)).toEqual([
      AROMA_GUARD_V1_PROGRAM_ID,
      SUBSCRIPTIONS_PROGRAM_ID,
    ]);
    expect(two[1]!.accounts?.[1]?.address).toBe(p.recurringDelegation);
  });

  test("refuses a non-owner and a plan address that does not match its seeds", async () => {
    const p = plan();
    const planAddress = await findPlanPda(owner.address, usd, 7n);
    await expect(
      buildCloseAndRevokeInstructions({
        owner: createNoopSigner(k(1)),
        planAddress,
        plan: p,
        revokeAuthority: false,
      }),
    ).rejects.toThrow(/owner/);
    await expect(
      buildCloseAndRevokeInstructions({
        owner,
        planAddress: k(3),
        plan: p,
        revokeAuthority: false,
      }),
    ).rejects.toThrow(/seeds/);
  });
});

describe("admin builders", () => {
  const admin = createNoopSigner(k(1));
  const four = [k(0), k(0), k(0), k(0)];
  const cfg = {
    admin: k(1),
    keeperAuthority: null,
    allowedFundingMints: four,
    maxSlippageBps: 300,
    maxOracleStalenessS: 60,
    catchUpWindowPeriods: 1,
    protocolFeeBps: 0,
    feeRecipient: k(0),
    maxInstallmentAmount: 1n,
    maxConfidenceBps: 200,
    treasury: k(2),
    allowedFreezeAuthorities: four,
    allowedPermanentDelegates: four,
    allowedTransferHookPrograms: four,
  };

  test("initialize_config reads ProgramData; the others target the config PDA", async () => {
    const init = await buildInitializeConfigInstruction({
      authority: admin,
      params: cfg,
    });
    expect(init.accounts?.map((a) => a.address)).toContain(
      await findProgramDataAddress(),
    );
    for (const ix of [
      await buildUpdateConfigInstruction(admin, cfg),
      await buildSetPausedInstruction(admin, true),
      await buildSetAssetEnabledInstruction(admin, k(4), false),
    ]) {
      expect(ix.programAddress).toBe(AROMA_GUARD_V1_PROGRAM_ID);
    }
    const reg = await buildRegisterAssetInstruction({
      admin,
      mint: k(4),
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      pythFeedId: new Uint8Array(32).fill(1),
    });
    expect(reg.accounts?.map((a) => a.address)).toContain(
      await findAssetPda(k(4)),
    );
    await expect(
      buildRegisterAssetInstruction({
        admin,
        mint: k(4),
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        pythFeedId: new Uint8Array(31),
      }),
    ).rejects.toThrow(/32 bytes/);
  });
});

describe("execute", () => {
  test("leg batching", () => {
    expect(planLegBatches(3)).toEqual([0b111]);
    expect(planLegBatches(5, 2)).toEqual([0b11, 0b1100, 0b10000]);
    expect(planLegBatches(20, 3)).toHaveLength(7);
    expect(() => planLegBatches(0)).toThrow();
    expect(() => planLegBatches(21)).toThrow();
  });

  test("six remaining accounts per leg, the owner's ATA as destination, optional fee account", async () => {
    const p = plan();
    const planAddress = await findPlanPda(owner.address, usd, 7n);
    const legs = [stocks[0]!, stocks[2]!].map((mint) => ({
      mint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      priceUpdate: k(7),
    }));
    const keeper = createNoopSigner(k(3));
    const ix = (await buildExecuteInstallmentInstruction({
      keeper,
      planAddress,
      plan: p,
      treasury: k(1),
      feeRecipient: null,
      period: 0,
      legMask: 0b101,
      legs,
    })) as ExecuteInstallmentInstruction & Instruction;
    const parsed = parseExecuteInstallmentInstruction(ix);
    expect(parsed.data).toMatchObject({ period: 0, legMask: 0b101 });
    expect(parsed.accounts.feeToken).toBeUndefined();
    const extra = (ix.accounts ?? []).slice(13);
    expect(extra).toHaveLength(12);
    expect(extra[2]!.address).toBe(
      await findAssociatedTokenAddress(
        owner.address,
        stocks[0]!,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    const withFee = await buildExecuteInstallmentInstruction({
      keeper,
      planAddress,
      plan: p,
      treasury: k(1),
      feeRecipient: k(2),
      period: 0,
      legMask: 0b001,
      legs: legs.slice(0, 1),
    });
    expect(withFee.accounts?.[8]?.address).toBe(
      await findAssociatedTokenAddress(k(2), usd, TOKEN_PROGRAM_ID),
    );
    await expect(
      buildExecuteInstallmentInstruction({
        keeper,
        planAddress,
        plan: p,
        treasury: k(1),
        feeRecipient: null,
        period: 0,
        legMask: 0b011,
        legs,
      }),
    ).rejects.toThrow(/mint does not match/);
    await expect(
      buildExecuteInstallmentInstruction({
        keeper,
        planAddress,
        plan: p,
        treasury: k(1),
        feeRecipient: null,
        period: 0,
        legMask: 0b001,
        legs,
      }),
    ).rejects.toThrow(/One leg input/);
    expect((await planAddresses({ ...p, owner: p.owner })).plan).toBe(
      planAddress,
    );
  });
});
