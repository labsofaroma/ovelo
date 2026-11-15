import {
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  type Transaction,
} from "@solana/kit";
import { planAddresses, TOKEN_PROGRAM_ID } from "@ovelo/guard";
import {
  getPlanClosedEventEncoder,
  getPlanCreatedEventEncoder,
} from "@ovelo/guard/generated";
import { describe, expect, it } from "vitest";
import { createKeyring } from "@/server/auth/trade";
import { prepareClose, prepareCreate } from "./prepare";
import { memoryInvestStore } from "./store";
import { submitPlan, type SubmitDeps } from "./submit";
import { memoryRedis } from "./test-redis";
import { planAccount, programLogs, world } from "./test-world";

const keyring = createKeyring("s".repeat(40));
const NOW = 1_763_100_000_000;

async function setup() {
  const w = await world();
  const store = memoryInvestStore();
  const redis = memoryRedis();
  const deps: SubmitDeps = {
    network: w.network,
    rpc: w.chain.rpc,
    keyring,
    store,
    redis,
    now: () => NOW,
  };
  const prep = {
    network: w.network,
    rpc: w.chain.rpc,
    keyring,
    store,
    baskets: async () => [],
    now: () => NOW,
  };
  const sign = async (wire: string) =>
    getBase64EncodedWireTransaction(
      await partiallySignTransaction(
        [w.owner.keyPair],
        getTransactionDecoder().decode(
          getBase64Encoder().encode(wire),
        ) as Transaction,
      ),
    );
  const addresses = await planAddresses({
    owner: w.owner.address,
    fundingMint: w.usd.address,
    fundingTokenProgram: TOKEN_PROGRAM_ID,
    nonce: 1n,
  });
  return { w, store, redis, deps, prep, sign, addresses };
}

const created = (plan: string, owner: string, mint: string) =>
  Uint8Array.from(
    getPlanCreatedEventEncoder().encode({
      plan: plan as never,
      owner: owner as never,
      fundingMint: mint as never,
      nonce: 1n,
      fundingAmount: 10_000_000n,
      periodSeconds: 604_800n,
      startsAt: 1n,
      expiresAt: 2n,
      periods: 4,
      outputs: 1,
    }),
  );

describe("submitPlan", () => {
  it("verifies, sends once, then writes the plan_create receipt and the index row; a replay is idempotent", async () => {
    const { w, store, deps, prep, sign } = await setup();
    const prepared = await prepareCreate(prep, {
      owner: w.owner.address,
      fundingAmount: "10000000",
      periodSeconds: 604_800,
      periods: 4,
      selection: {
        kind: "assets",
        outputs: [{ mint: w.aapl.address, weightBps: 10_000 }],
      },
    });
    w.chain.transactions.set("*", {
      logs: programLogs(created(prepared.plan, w.owner.address, w.usd.address)),
    });
    w.chain.accounts.set(
      prepared.plan,
      planAccount({
        owner: w.owner.address,
        fundingMint: w.usd.address,
        outputs: [
          { mint: w.aapl.address, weightBps: 10_000, maxSlippageBps: 100 },
        ],
      }),
    );
    const body = {
      authorization: prepared.authorization,
      transaction: await sign(prepared.transaction),
    };
    const first = await submitPlan(deps, body);
    expect(first).toMatchObject({
      kind: "plan_create",
      status: "confirmed",
      plan: prepared.plan,
    });
    expect(w.chain.sent).toHaveLength(1);
    expect([...store.receipts.values()]).toEqual([
      expect.objectContaining({
        kind: "plan_create",
        planPda: prepared.plan,
        amountIn: "10000000",
        wallet: w.owner.address,
        status: "confirmed",
      }),
    ]);
    expect(store.rows.get(prepared.plan)).toMatchObject({
      status: "active",
      owner: w.owner.address,
      periods: 4,
    });
    expect(await submitPlan(deps, body)).toEqual(first);
    expect(w.chain.sent).toHaveLength(1);
  });

  it("refuses a tampered authorization, an unsigned transaction and an authorization for another cluster", async () => {
    const { w, deps, prep, sign } = await setup();
    const prepared = await prepareCreate(prep, {
      owner: w.owner.address,
      fundingAmount: "10000000",
      periodSeconds: 604_800,
      periods: 4,
      selection: {
        kind: "assets",
        outputs: [{ mint: w.aapl.address, weightBps: 10_000 }],
      },
    });
    const signed = await sign(prepared.transaction);
    const tampered =
      prepared.authorization.slice(0, -3) +
      (prepared.authorization.endsWith("AAA") ? "BBB" : "AAA");
    await expect(
      submitPlan(deps, { authorization: tampered, transaction: signed }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_INVALID" });
    await expect(
      submitPlan(deps, {
        authorization: prepared.authorization,
        transaction: prepared.transaction,
      }),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    const localnet = {
      ...deps,
      network: { ...deps.network, cluster: "localnet" as const },
    };
    await expect(
      submitPlan(localnet, {
        authorization: prepared.authorization,
        transaction: signed,
      }),
    ).rejects.toMatchObject({ code: "WRONG_CLUSTER" });
    expect(w.chain.sent).toHaveLength(0);
  });

  it("a confirmed transaction without the authorized event is never recorded, and can be retried", async () => {
    const { w, store, redis, deps, prep, sign } = await setup();
    const prepared = await prepareCreate(prep, {
      owner: w.owner.address,
      fundingAmount: "10000000",
      periodSeconds: 604_800,
      periods: 4,
      selection: {
        kind: "assets",
        outputs: [{ mint: w.aapl.address, weightBps: 10_000 }],
      },
    });
    w.chain.transactions.set("*", { logs: ["Program log: something else"] });
    const body = {
      authorization: prepared.authorization,
      transaction: await sign(prepared.transaction),
    };
    await expect(submitPlan(deps, body)).rejects.toMatchObject({
      code: "TRANSACTION_FAILED",
    });
    expect(store.receipts.size).toBe(0);
    expect(redis.store.size).toBe(0);
    w.chain.statusError = { InstructionError: [2, { Custom: 6000 }] };
    await expect(submitPlan(deps, body)).rejects.toMatchObject({
      code: "TRANSACTION_FAILED",
    });
  });

  it("close + revoke: receipt, index row closed, and the result read back from chain", async () => {
    const { w, store, deps, prep, sign, addresses } = await setup();
    w.chain.accounts.set(
      addresses.plan,
      planAccount({
        owner: w.owner.address,
        fundingMint: w.usd.address,
        outputs: [
          { mint: w.aapl.address, weightBps: 10_000, maxSlippageBps: 100 },
        ],
        executedPeriods: 3,
        skippedPeriods: 1,
      }),
    );
    await store.upsertRows([
      {
        pda: addresses.plan,
        owner: w.owner.address,
        fundingMint: w.usd.address,
        nonce: "1",
        status: "active",
        nextDueAt: 1n,
        lastPeriod: 3,
        skippedPeriods: 1,
        executedPeriods: 3,
        periods: 4,
      },
    ]);
    const prepared = await prepareClose(prep, addresses.plan, w.owner.address);
    const closed = Uint8Array.from(
      getPlanClosedEventEncoder().encode({
        plan: addresses.plan,
        owner: w.owner.address,
        returnedAmount: 0n,
        executedPeriods: 3,
        skippedPeriods: 1,
      }),
    );
    w.chain.transactions.set("*", {
      logs: programLogs(closed),
      pre: [1_000_000_000],
      post: [1_007_000_000],
    });
    w.chain.accounts.delete(addresses.plan);
    const result = await submitPlan(deps, {
      authorization: prepared.authorization,
      transaction: await sign(prepared.transaction),
    });
    expect(result.result).toEqual([
      "Plan closed: the plan account no longer exists.",
      "Recurring approval revoked: the delegation account no longer exists.",
      "Executed 3 installments, skipped 1.",
      "Rent returned to your wallet: 0.007 SOL net of the network fee.",
    ]);
    expect(store.rows.get(addresses.plan)?.status).toBe("closed");
    expect([...store.receipts.values()][0]).toMatchObject({
      kind: "plan_close",
      planPda: addresses.plan,
    });
  });
});
