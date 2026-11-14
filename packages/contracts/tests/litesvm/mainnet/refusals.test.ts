/**
 * Default (mainnet) build: every refusal on chain with the real Jupiter, Whirlpool and xStocks
 * binaries. Routes are tampered AFTER the client builder (which refuses them before signing), so
 * each case proves the program's own check.
 */
import { describe, expect, test } from "vitest";
import { AccountRole, type Address } from "@solana/kit";
import * as v1 from "@aroma/guard";
import { errorCode } from "../helpers";
import { MainnetWorld, USDC } from "./world";
import { patchAccount, patchData, setU16 } from "./tamper";

const R = v1.ROUTE_V2;

async function oneLeg(o: Parameters<typeof MainnetWorld.create>[0] = {}) {
  const w = await MainnetWorld.create(o);
  const plan = await w.createPlan({
    stocks: [w.stocks[0]!],
    weights: [10_000],
    amount: 5_000_000n,
  });
  return { w, plan };
}

/** Everything that must not move when a transaction is refused. */
async function frozen(w: MainnetWorld, plan: Address) {
  const staging = await v1.findAssociatedTokenAddress(
    plan,
    USDC,
    v1.TOKEN_PROGRAM_ID,
  );
  return () => ({
    ownerUsd: w.env.tokenAmount(w.ownerUsd),
    staging: w.env.tokenAmount(staging),
    owned: w.stocks.map((s) => w.env.tokenAmount(s.ownerAta)),
    plan: Buffer.from(w.env.data(plan)!).toString("hex"),
  });
}

describe("execute_installment_routed refusals (default build)", () => {
  test("slippage failure on a later leg rolls back the whole transaction, the pull and the first leg included", async () => {
    const w = await MainnetWorld.create();
    const plan = await w.createPlan();
    const read = await frozen(w, plan);
    const before = read();
    // Leg 1's oracle is 5 % below the market: its floor is above what the pool can deliver.
    const prices = [
      await w.postPrice(w.stocks[0]!),
      await w.postPrice(w.stocks[1]!, {
        price: (w.marketPrice(w.stocks[1]!, 1) * 95n) / 100n,
      }),
    ];
    const r = await w.execute(plan, 0, 0b011, { prices });
    expect(errorCode(r.logs)).toBe("OutputBelowMinimum");
    expect(read()).toEqual(before);
    // The same transaction with a fair price for leg 1 succeeds.
    expect((await w.execute(plan, 0, 0b011)).ok).toBe(true);
  });

  test("a destination that is not the owner's ATA (another wallet's ATA)", async () => {
    const { w, plan } = await oneLeg();
    const other = await w.env.signer();
    const s = w.stocks[0]!;
    await w.env.send(other, [
      (await import("../helpers")).ataIx(other.address, s.mint),
    ]);
    const theirs = await v1.findAssociatedTokenAddress(
      other.address,
      s.mint,
      v1.TOKEN_2022_PROGRAM_ID,
    );
    const ixs = patchAccount(
      await w.executeIxs(plan, 0, 0b1),
      0,
      R.destination,
      theirs,
    );
    expect(errorCode((await w.env.trySend(w.keeper, ixs)).logs)).toBe(
      "WrongDestination",
    );
  });

  test("a route that pays someone else through its own transit account", async () => {
    const { w, plan } = await oneLeg();
    const thief = await w.env.signer();
    await w.env.send(thief, [
      (await import("../helpers")).ataIx(thief.address, w.stocks[0]!.mint),
    ]);
    const transit = await v1.findAssociatedTokenAddress(
      thief.address,
      w.stocks[0]!.mint,
      v1.TOKEN_2022_PROGRAM_ID,
    );
    const ixs = patchAccount(
      await w.executeIxs(plan, 0, 0b1),
      0,
      R.transit,
      transit,
    );
    expect(errorCode((await w.env.trySend(w.keeper, ixs)).logs)).toBe(
      "RouteAccountMismatch",
    );
  });

  test("a route that drains staging: staging named in the route, or more than the leg's amount", async () => {
    const { w, plan } = await oneLeg();
    const staging = await v1.findAssociatedTokenAddress(
      plan,
      USDC,
      v1.TOKEN_PROGRAM_ID,
    );
    // Staging in a hop slot (the Memo program's position in this Whirlpool route).
    const named = patchAccount(
      await w.executeIxs(plan, 0, 0b1),
      0,
      13,
      staging,
      AccountRole.WRITABLE,
    );
    expect(errorCode((await w.env.trySend(w.keeper, named)).logs)).toBe(
      "RouteAccountForbidden",
    );
    const more = patchData(await w.executeIxs(plan, 0, 0b1), 0, (d) => {
      new DataView(d.buffer, d.byteOffset).setBigUint64(8, 5_000_001n, true);
      return d;
    });
    expect(errorCode((await w.env.trySend(w.keeper, more)).logs)).toBe(
      "RouteTermsMismatch",
    );
  });

  test("a route touching the plan's other funds or the owner's funding account", async () => {
    const { w, plan } = await oneLeg();
    const s = w.stocks[0]!;
    // A token account owned by the plan PDA (created by anyone).
    await w.env.send(w.admin, [
      await v1.createAtaIdempotentInstruction(
        w.admin,
        plan,
        s.mint,
        v1.TOKEN_2022_PROGRAM_ID,
      ),
    ]);
    const planOwned = await v1.findAssociatedTokenAddress(
      plan,
      s.mint,
      v1.TOKEN_2022_PROGRAM_ID,
    );
    for (const target of [planOwned, w.ownerUsd]) {
      const ixs = patchAccount(
        await w.executeIxs(plan, 0, 0b1),
        0,
        13,
        target,
        AccountRole.WRITABLE,
      );
      expect(errorCode((await w.env.trySend(w.keeper, ixs)).logs)).toBe(
        "RouteAccountForbidden",
      );
    }
  });

  test("route terms: another Jupiter instruction, a platform fee, a positive-slippage share", async () => {
    const { w, plan } = await oneLeg();
    const shared = patchData(await w.executeIxs(plan, 0, 0b1), 0, (d) => {
      d.set([209, 152, 83, 147, 124, 254, 216, 233], 0); // shared_accounts_route_v2
      return d;
    });
    expect(errorCode((await w.env.trySend(w.keeper, shared)).logs)).toBe(
      "UnsupportedRoute",
    );
    for (const offset of [26, 28]) {
      const ixs = patchData(
        await w.executeIxs(plan, 0, 0b1),
        0,
        setU16(offset, 50),
      );
      expect(errorCode((await w.env.trySend(w.keeper, ixs)).logs)).toBe(
        "RouteTermsMismatch",
      );
    }
  });

  test("the swap authority may not be writable; the program account must be Jupiter's", async () => {
    const { w, plan } = await oneLeg();
    const swap = await v1.findSwapAuthorityPda();
    const writable = patchAccount(
      await w.executeIxs(plan, 0, 0b1),
      0,
      R.authority,
      swap,
      AccountRole.WRITABLE,
    );
    expect(errorCode((await w.env.trySend(w.keeper, writable)).logs)).toBe(
      "RouteAccountMismatch",
    );
    const fake = patchAccount(
      await w.executeIxs(plan, 0, 0b1),
      0,
      R.program,
      v1.SUBSCRIPTIONS_PROGRAM_ID,
    );
    expect(errorCode((await w.env.trySend(w.keeper, fake)).logs)).toBe(
      "UnsupportedRoute",
    );
  });

  test("decision 1: a price older than 20 s is refused even though the config allows 60 s; 20 s is accepted", async () => {
    const { w, plan } = await oneLeg();
    const s = w.stocks[0]!;
    const old = await w.postPrice(s, { publishTime: w.env.now - 21n });
    expect(
      errorCode((await w.execute(plan, 0, 0b1, { prices: [old] })).logs),
    ).toBe("StalePrice");
    const edge = await w.postPrice(s, { publishTime: w.env.now - 20n });
    expect((await w.execute(plan, 0, 0b1, { prices: [edge] })).ok).toBe(true);
  });

  test("decision 1: keeper-only (no keeper configured, or another signer)", async () => {
    const none = await oneLeg({ keeper: "none" });
    expect(errorCode((await none.w.execute(none.plan, 0, 0b1)).logs)).toBe(
      "KeeperRequired",
    );
    const { w, plan } = await oneLeg();
    const other = await w.env.signer();
    expect(
      errorCode((await w.execute(plan, 0, 0b1, { keeper: other })).logs),
    ).toBe("NotKeeper");
  });

  test("a low-confidence price", async () => {
    const { w, plan } = await oneLeg();
    const s = w.stocks[0]!;
    const price = w.marketPrice(s);
    const wide = await w.postPrice(s, { conf: (price * 3n) / 100n }); // 300 bps > 200 bps
    expect(
      errorCode((await w.execute(plan, 0, 0b1, { prices: [wide] })).logs),
    ).toBe("ConfidenceTooWide");
  });

  test("a paused xStock mint fails closed at execution", async () => {
    const { w, plan } = await oneLeg();
    const mint = w.stocks[0]!.mint;
    const data = Buffer.from(w.env.data(mint)!);
    // Walk the Token-2022 TLV after the 165-byte base and account-type byte: Pausable = 26.
    let at = 166;
    while (at + 4 <= data.length && data.readUInt16LE(at) !== 26)
      at += 4 + data.readUInt16LE(at + 2);
    expect(data.readUInt16LE(at)).toBe(26);
    data[at + 4 + 32] = 1; // PausableConfig { authority, paused }
    const account = w.env.svm.getAccount(mint);
    w.env.svm.setAccount({ ...account, address: mint, data } as never);
    expect(errorCode((await w.execute(plan, 0, 0b1)).logs)).toBe("MintPaused");
  });

  test("the non-routed instruction stays closed in this build", async () => {
    const { w, plan } = await oneLeg();
    const p = w.plan(plan);
    const ix = await v1.buildExecuteInstallmentInstruction({
      keeper: w.keeper,
      planAddress: plan,
      plan: p,
      treasury: w.treasury.address,
      feeRecipient: null,
      period: 0,
      legMask: 0b1,
      legs: [
        {
          mint: w.stocks[0]!.mint,
          tokenProgram: v1.TOKEN_2022_PROGRAM_ID,
          priceUpdate: await w.postPrice(w.stocks[0]!),
        },
      ],
    });
    expect(errorCode((await w.env.trySend(w.keeper, [ix])).logs)).toBe(
      "MainnetExecutionUnavailable",
    );
  });
});
