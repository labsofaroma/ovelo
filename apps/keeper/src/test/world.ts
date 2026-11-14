/** Test-only keeper world: a deployed v1 on the fake chain, memory stores, a fake Hermes. */
import type { webcrypto } from "node:crypto";
import {
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import {
  findAssetPda,
  findConfigPda,
  NO_PERIOD,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  V1_PROGRAM_ID,
  type PlanIndexRow,
} from "@aroma/guard";
import {
  getAssetEncoder,
  getConfigEncoder,
  getInstallmentExecutedEventEncoder,
  getPlanDecoder,
  getPlanEncoder,
  type Plan,
} from "@aroma/guard/generated";
import type { InstallmentReceipt, KeeperDb } from "../db";
import { createLogger } from "../log";
import type { KeeperRedis } from "../store";
import { fakeKeeperChain, v1Logs } from "./chain";
export { fakeHermes } from "./hermes";

const NONE = "11111111111111111111111111111111" as Address;
const four = (a: Address) =>
  [a, NONE, NONE, NONE] as [Address, Address, Address, Address];
export const FEEDS = [
  "0x" + "a1".repeat(32),
  "0x" + "b2".repeat(32),
  "0x" + "c3".repeat(32),
  "0x" + "d4".repeat(32),
];
export const silent = createLogger("silent");

export function memoryRedis(): KeeperRedis & {
  store: Map<string, string>;
  lists: Map<string, string[]>;
} {
  const store = new Map<string, string>();
  const lists = new Map<string, string[]>();
  return {
    store,
    lists,
    async set(key, value, o = {}) {
      if (o.nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async del(...keys) {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    },
    async eval(_script, keys, args) {
      if (store.get(keys[0]!) === args[0]) {
        store.delete(keys[0]!);
        return 1;
      }
      return 0;
    },
    async incr(key) {
      const n = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(n));
      return n;
    },
    async expire() {
      return 1;
    },
    async lpush(key, ...values) {
      const list = lists.get(key) ?? [];
      list.unshift(...values.reverse());
      lists.set(key, list);
      return list.length;
    },
    async lrange(key, start, stop) {
      return (lists.get(key) ?? []).slice(start, stop + 1);
    },
    async llen(key) {
      return (lists.get(key) ?? []).length;
    },
    async lrem(key, _count, value) {
      const list = lists.get(key) ?? [];
      const i = list.indexOf(value);
      if (i < 0) return 0;
      list.splice(i, 1);
      return 1;
    },
  };
}

export function memoryDb(): KeeperDb & {
  rows: Map<string, PlanIndexRow>;
  receipts: InstallmentReceipt[];
} {
  const rows = new Map<string, PlanIndexRow>();
  const receipts: InstallmentReceipt[] = [];
  return {
    rows,
    receipts,
    async dueRows(now, limit) {
      const t = BigInt(Math.floor(now.getTime() / 1000));
      return [...rows.values()]
        .filter(
          (r) =>
            r.status === "active" && r.nextDueAt !== null && r.nextDueAt <= t,
        )
        .slice(0, limit);
    },
    async allRows() {
      return [...rows.values()];
    },
    async upsertRows(list) {
      list.forEach((r) => rows.set(r.pda, { ...r }));
    },
    async closeRows(pdas) {
      pdas.forEach((p) => {
        const r = rows.get(p);
        if (r) rows.set(p, { ...r, status: "closed", nextDueAt: null });
      });
    },
    async insertInstallment(receipt) {
      if (receipts.some((r) => r.signature === receipt.signature)) return false;
      receipts.push(receipt);
      return true;
    },
  };
}

/** A 64-byte secret generated at runtime (seed ‖ public key); never a committed literal. */
export async function freshSecret(): Promise<number[]> {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  return [...pkcs8.slice(-32), ...raw];
}

export async function keeperWorld(
  options: {
    outputs?: number;
    keeperAuthority?: Address;
    lastExecutedPeriod?: number;
    periodSeconds?: bigint;
  } = {},
) {
  const chain = fakeKeeperChain();
  const keeperSecret = await freshSecret();
  const keeper: KeyPairSigner = await createKeyPairSignerFromBytes(
    Uint8Array.from(keeperSecret),
  );
  const [owner, usd, treasury, plan] = [
    await generateKeyPairSigner(),
    await generateKeyPairSigner(),
    await generateKeyPairSigner(),
    await generateKeyPairSigner(),
  ];
  const mints = [] as Address[];
  for (let i = 0; i < (options.outputs ?? 1); i += 1)
    mints.push((await generateKeyPairSigner()).address);
  const config = {
    version: 1,
    admin: treasury.address,
    keeperAuthority: {
      __option: "Some" as const,
      value: options.keeperAuthority ?? keeper.address,
    },
    paused: false,
    allowedFundingMints: four(usd.address),
    maxSlippageBps: 300,
    maxOracleStalenessS: 60,
    catchUpWindowPeriods: 1,
    protocolFeeBps: 0,
    feeRecipient: NONE,
    maxInstallmentAmount: 500_000_000n,
    bump: 255,
    maxConfidenceBps: 200,
    treasury: treasury.address,
    allowedFreezeAuthorities: four(NONE),
    allowedPermanentDelegates: four(NONE),
    allowedTransferHookPrograms: four(NONE),
    reserved: new Uint8Array(128),
  };
  chain.accounts.set(await findConfigPda(), {
    owner: V1_PROGRAM_ID,
    data: Uint8Array.from(getConfigEncoder().encode(config)),
  });
  for (const [i, mint] of mints.entries())
    chain.accounts.set(await findAssetPda(mint), {
      owner: V1_PROGRAM_ID,
      data: Uint8Array.from(
        getAssetEncoder().encode({
          version: 1,
          mint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          pythFeedId: Uint8Array.from(Buffer.from(FEEDS[i]!.slice(2), "hex")),
          decimals: 8,
          enabled: true,
          bump: 1,
          extensions: 0n,
          scaledUiAmount: false,
          mockMintBump: 1,
          registeredAt: 1n,
          reserved: new Uint8Array(64),
        }),
      ),
    });
  const period = options.periodSeconds ?? 100n;
  const startsAt = BigInt(chain.blockTime) - 3n * period - 5n; // now is 5 s into period 3
  const weights = mints.map((_, i) =>
    i === 0
      ? 10_000 - Math.floor(10_000 / mints.length) * (mints.length - 1)
      : Math.floor(10_000 / mints.length),
  );
  let state: Plan = {
    discriminator: new Uint8Array(8),
    version: 1,
    owner: owner.address,
    fundingMint: usd.address,
    nonce: 1n,
    fundingAmount: 10_000_000n,
    periodSeconds: period,
    startsAt,
    expiresAt: startsAt + 6n * period,
    createdAt: startsAt,
    periods: 6,
    executedPeriods: 0,
    skippedPeriods: 0,
    lastExecutedPeriod: options.lastExecutedPeriod ?? 1,
    lastExecutedAt: 0n,
    pausedByOwner: false,
    legBitmap: 0,
    subscriptionAuthority: NONE,
    recurringDelegation: NONE,
    subscriptionInitId: 0n,
    bump: 255,
    fundingTokenProgram: TOKEN_PROGRAM_ID,
    catchUpWindowPeriods: 1,
    inProgressPeriod: NO_PERIOD,
    stagingStartBalance: 0n,
    outputs: mints.map((mint, i) => ({
      mint,
      weightBps: weights[i]!,
      maxSlippageBps: 100,
    })),
    reserved: new Uint8Array(96),
  };
  if (state.lastExecutedPeriod !== NO_PERIOD)
    state = { ...state, executedPeriods: state.lastExecutedPeriod + 1 };
  const writePlan = () =>
    chain.accounts.set(plan.address, {
      owner: V1_PROGRAM_ID,
      data: Uint8Array.from(getPlanEncoder().encode(state)),
    });
  writePlan();
  /** The program's effect of an execute transaction for `legMask` in `period`. */
  const executed: { period: number; legMask: number }[] = [];
  chain.logsFor = (programs) => {
    if (!programs.includes(V1_PROGRAM_ID)) return [];
    const remaining = state.outputs
      .map((_, i) => i)
      .filter((i) => !((state.legBitmap >>> i) & 1));
    const batch = remaining.slice(0, 3);
    const mask = batch.reduce((m, i) => m | (1 << i), 0);
    const target = state.legBitmap
      ? state.inProgressPeriod
      : Math.max(
          state.lastExecutedPeriod === NO_PERIOD
            ? 0
            : state.lastExecutedPeriod + 1,
          Number(
            (BigInt(chain.blockTime) - state.startsAt) / state.periodSeconds,
          ) - state.catchUpWindowPeriods,
        );
    const next =
      state.lastExecutedPeriod === NO_PERIOD ? 0 : state.lastExecutedPeriod + 1;
    const newlySkipped = state.legBitmap ? 0 : target - next;
    const bitmap = state.legBitmap | mask;
    const complete = bitmap === (1 << state.outputs.length) - 1;
    executed.push({ period: target, legMask: mask });
    state = complete
      ? {
          ...state,
          legBitmap: 0,
          inProgressPeriod: NO_PERIOD,
          lastExecutedPeriod: target,
          executedPeriods: state.executedPeriods + 1,
          skippedPeriods: state.skippedPeriods + newlySkipped,
        }
      : {
          ...state,
          legBitmap: bitmap,
          inProgressPeriod: target,
          skippedPeriods: state.skippedPeriods + newlySkipped,
        };
    writePlan();
    return v1Logs(
      Uint8Array.from(
        getInstallmentExecutedEventEncoder().encode({
          plan: plan.address,
          period: target,
          newlySkipped,
          periodComplete: complete,
          legs: batch.map((leg) => ({
            leg,
            mint: mints[leg]!,
            amountIn: 1_000_000n,
            fee: 0n,
            amountOut: 4_321n,
            minOut: 4_200n,
            oraclePrice: 23_142_000_000n,
            oracleExpo: -8,
            oraclePublishTime: BigInt(chain.blockTime),
            multiplierFp: 1_000_000_000_000n,
          })),
        }),
      ),
    );
  };
  return {
    chain,
    keeper,
    keeperSecret,
    owner,
    usd,
    treasury,
    plan: plan.address,
    mints,
    config,
    executed,
    state: () => state,
    setState: (next: Partial<Plan>) => {
      state = { ...state, ...next };
      writePlan();
    },
    decode: (data: Uint8Array) => getPlanDecoder().decode(data),
    db: memoryDb(),
    redis: memoryRedis(),
  };
}
