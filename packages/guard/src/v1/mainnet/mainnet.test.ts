import { describe, expect, test } from "vitest";
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  type Address,
} from "@solana/kit";
import { getExecuteInstallmentRoutedInstructionDataDecoder } from "../generated";
import {
  AROMA_GUARD_V1_PROGRAM_ID,
  SUBSCRIPTIONS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../constants";
import { findAssociatedTokenAddress, findPlanPda } from "../pdas";
import {
  JUPITER_EVENT_AUTHORITY,
  JUPITER_V6_PROGRAM_ID,
  ROUTE_V2,
  ROUTE_V2_DISCRIMINATOR,
  ROUTED_FIXED_ACCOUNTS_PER_LEG,
} from "./constants";
import { findSwapAuthorityPda, swapAccountsFor } from "./pdas";
import {
  checkRouteLeg,
  parseRouteV2,
  routeFromApi,
  RouteRejected,
  withAmounts,
  type JupiterRoute,
  type RouteExpectation,
} from "./route";
import {
  buildExecuteInstallmentRoutedInstruction,
  routedLegAmounts,
} from "./execute";
import { swapAuthorityAccountInstructions } from "./setup";

const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const STOCK = address("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const POOL = address("Djdm88bGU5NLRoGZaWTRrTTY1Kfh8FmRDv1q8Js7yLKF");

function data(
  o: {
    inAmount?: bigint;
    fee?: number;
    positive?: number;
    steps?: number;
  } = {},
) {
  const d = new Uint8Array(40);
  const v = new DataView(d.buffer);
  d.set(ROUTE_V2_DISCRIMINATOR, 0);
  v.setBigUint64(8, o.inAmount ?? 5_000_000n, true);
  v.setBigUint64(16, 1_399_903n, true);
  v.setUint16(24, 100, true);
  v.setUint16(26, o.fee ?? 0, true);
  v.setUint16(28, o.positive ?? 0, true);
  v.setUint32(30, o.steps ?? 1, true);
  return d;
}

async function fixture(owner: Address) {
  const swap = await swapAccountsFor({
    fundingMint: USDC,
    fundingTokenProgram: TOKEN_PROGRAM_ID,
    outputMint: STOCK,
    outputTokenProgram: TOKEN_2022_PROGRAM_ID,
  });
  const destination = await findAssociatedTokenAddress(
    owner,
    STOCK,
    TOKEN_2022_PROGRAM_ID,
  );
  const prefix: [Address, AccountRole][] = [
    [swap.authority, AccountRole.READONLY],
    [swap.source, AccountRole.WRITABLE],
    [swap.transit, AccountRole.WRITABLE],
    [USDC, AccountRole.READONLY],
    [STOCK, AccountRole.READONLY],
    [TOKEN_PROGRAM_ID, AccountRole.READONLY],
    [TOKEN_2022_PROGRAM_ID, AccountRole.READONLY],
    [destination, AccountRole.WRITABLE],
    [JUPITER_EVENT_AUTHORITY, AccountRole.READONLY],
    [JUPITER_V6_PROGRAM_ID, AccountRole.READONLY],
    [POOL, AccountRole.WRITABLE],
  ];
  const route: JupiterRoute = {
    accounts: prefix.map(([a, role]) => ({ address: a, role })),
    data: data(),
  };
  const expectation: RouteExpectation = {
    swapAuthority: swap.authority,
    source: swap.source,
    transit: swap.transit,
    fundingMint: USDC,
    fundingTokenProgram: TOKEN_PROGRAM_ID,
    outputMint: STOCK,
    outputTokenProgram: TOKEN_2022_PROGRAM_ID,
    destination,
    amountIn: 5_000_000n,
    forbidden: [SUBSCRIPTIONS_PROGRAM_ID],
  };
  return { route, expectation, swap };
}

const reject = (fn: () => unknown, reason: RegExp) => {
  expect(fn).toThrow(RouteRejected);
  expect(fn).toThrow(reason);
};

describe("route_v2 parsing", () => {
  test("reads the fixed head", () => {
    expect(parseRouteV2(data())).toEqual({
      inAmount: 5_000_000n,
      quotedOutAmount: 1_399_903n,
      slippageBps: 100,
      platformFeeBps: 0,
      positiveSlippageBps: 0,
      routeSteps: 1,
    });
  });
  test("refuses other instructions, short, oversized and empty routes", () => {
    const other = data();
    other[0] = 209;
    reject(() => parseRouteV2(other), /not a route_v2/);
    reject(() => parseRouteV2(data().subarray(0, 33)), /not a route_v2/);
    reject(() => parseRouteV2(new Uint8Array(1_025)), /not a route_v2/);
    reject(() => parseRouteV2(data({ steps: 0 })), /empty route/);
  });
  test("API instructions: roles kept, signers dropped; non-Jupiter refused", () => {
    const route = routeFromApi({
      programId: JUPITER_V6_PROGRAM_ID,
      accounts: [
        { pubkey: USDC, isSigner: true, isWritable: false },
        { pubkey: POOL, isSigner: false, isWritable: true },
      ],
      data: Buffer.from(data()).toString("base64"),
    });
    expect(route.accounts.map((a) => a.role)).toEqual([
      AccountRole.READONLY,
      AccountRole.WRITABLE,
    ]);
    expect(parseRouteV2(route.data).inAmount).toBe(5_000_000n);
    reject(
      () => routeFromApi({ programId: USDC, accounts: [], data: "" }),
      /not a Jupiter/,
    );
  });
  test("withAmounts re-encodes amounts only", () => {
    const route: JupiterRoute = { accounts: [], data: data() };
    const next = withAmounts(route, 7n, 8n);
    expect(parseRouteV2(next.data)).toMatchObject({
      inAmount: 7n,
      quotedOutAmount: 8n,
      slippageBps: 100,
    });
    expect(parseRouteV2(route.data).inAmount).toBe(5_000_000n);
  });
});

describe("checkRouteLeg mirrors the program's pre-CPI checks", () => {
  test("accepts the expected prefix and terms", async () => {
    const { route, expectation } = await fixture(USDC);
    expect(checkRouteLeg(route, expectation).inAmount).toBe(5_000_000n);
  });
  test("refuses each wrong prefix account", async () => {
    const { route, expectation } = await fixture(USDC);
    const names: [number, RegExp][] = [
      [ROUTE_V2.program, /wrong program/],
      [ROUTE_V2.eventAuthority, /wrong event authority/],
      [ROUTE_V2.authority, /wrong authority/],
      [ROUTE_V2.source, /wrong source$/],
      [ROUTE_V2.transit, /wrong transit/],
      [ROUTE_V2.sourceMint, /wrong source mint/],
      [ROUTE_V2.destinationMint, /wrong destination mint/],
      [ROUTE_V2.sourceTokenProgram, /wrong source program/],
      [ROUTE_V2.destinationTokenProgram, /wrong destination program/],
      [ROUTE_V2.destination, /wrong destination$/],
    ];
    for (const [index, reason] of names) {
      const accounts = route.accounts.map((a) => ({ ...a }));
      accounts[index] = { ...accounts[index]!, address: POOL };
      reject(() => checkRouteLeg({ ...route, accounts }, expectation), reason);
    }
  });
  test("refuses a writable authority, forbidden accounts, too few or too many accounts", async () => {
    const { route, expectation, swap } = await fixture(USDC);
    const writable = route.accounts.map((a) =>
      a.address === swap.authority ? { ...a, role: AccountRole.WRITABLE } : a,
    );
    reject(
      () => checkRouteLeg({ ...route, accounts: writable }, expectation),
      /writable authority/,
    );
    const forbidden = [
      ...route.accounts,
      { address: SUBSCRIPTIONS_PROGRAM_ID, role: AccountRole.READONLY },
    ];
    reject(
      () => checkRouteLeg({ ...route, accounts: forbidden }, expectation),
      /forbidden/,
    );
    reject(
      () =>
        checkRouteLeg(
          { ...route, accounts: route.accounts.slice(0, 10) },
          expectation,
        ),
      /no hop/,
    );
    const many = [
      ...route.accounts,
      ...Array.from({ length: 250 }, () => route.accounts[10]!),
    ];
    reject(
      () => checkRouteLeg({ ...route, accounts: many }, expectation),
      /too many/,
    );
  });
  test("refuses a different amount, a platform fee or a positive-slippage share", async () => {
    const { route, expectation } = await fixture(USDC);
    for (const d of [
      data({ inAmount: 4_999_999n }),
      data({ fee: 1 }),
      data({ positive: 50 }),
    ])
      reject(
        () => checkRouteLeg({ ...route, data: d }, expectation),
        /terms differ/,
      );
  });
});

describe("routed builder", () => {
  async function plan(owner: Address, outputs = 1) {
    const mints = [STOCK, USDC].slice(0, outputs);
    return {
      owner,
      fundingMint: USDC,
      fundingTokenProgram: TOKEN_PROGRAM_ID,
      fundingAmount: 5_000_000n,
      outputs: mints.map((mint) => ({
        mint,
        weightBps: 10_000 / outputs,
        maxSlippageBps: 100,
      })),
      subscriptionAuthority: address(
        "SysvarC1ock11111111111111111111111111111111",
      ),
      recurringDelegation: address(
        "SysvarRent111111111111111111111111111111111",
      ),
    };
  }

  test("leg amounts: weight split, fee floor, amount_in", () => {
    const p = {
      fundingAmount: 10_000_000n,
      outputs: [5_000, 3_000, 2_000].map((weightBps) => ({
        mint: USDC,
        weightBps,
        maxSlippageBps: 100,
      })),
    };
    expect(routedLegAmounts(p, 1, 25)).toEqual({
      legFunding: 3_000_000n,
      fee: 7_500n,
      amountIn: 2_992_500n,
    });
    expect(() => routedLegAmounts(p, 3, 0)).toThrow(/no leg 3/);
  });

  test("lays out [asset, price, …route] per leg, strips signers, encodes the route", async () => {
    const keeper = await generateKeyPairSigner();
    const owner = (await generateKeyPairSigner()).address;
    const { route } = await fixture(owner);
    const planAddress = await findPlanPda(owner, USDC, 1n);
    const ix = await buildExecuteInstallmentRoutedInstruction({
      keeper,
      planAddress,
      plan: await plan(owner),
      treasury: owner,
      feeRecipient: null,
      protocolFeeBps: 0,
      period: 0,
      legMask: 0b1,
      legs: [
        {
          mint: STOCK,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          priceUpdate: POOL,
          route,
        },
      ],
    });
    expect(ix.programAddress).toBe(AROMA_GUARD_V1_PROGRAM_ID);
    const accounts = ix.accounts!;
    expect(accounts).toHaveLength(
      13 + ROUTED_FIXED_ACCOUNTS_PER_LEG + route.accounts.length,
    );
    const tail = accounts.slice(13 + ROUTED_FIXED_ACCOUNTS_PER_LEG);
    expect(tail.map((a) => a.address)).toEqual(
      route.accounts.map((a) => a.address),
    );
    expect(
      tail.every(
        (a) =>
          a.role === AccountRole.READONLY || a.role === AccountRole.WRITABLE,
      ),
    ).toBe(true);
    const decoded = getExecuteInstallmentRoutedInstructionDataDecoder().decode(
      ix.data!,
    );
    expect(decoded.routes).toHaveLength(1);
    expect(decoded.routes[0]!.accountCount).toBe(route.accounts.length);
    expect([decoded.period, decoded.legMask]).toEqual([0, 1]);
  });

  test("refuses a fee without a recipient, a mismatched mask, a wrong mint, and a bad route", async () => {
    const keeper = await generateKeyPairSigner();
    const owner = (await generateKeyPairSigner()).address;
    const { route } = await fixture(owner);
    const base = {
      keeper,
      planAddress: await findPlanPda(owner, USDC, 1n),
      plan: await plan(owner),
      treasury: owner,
      feeRecipient: null,
      protocolFeeBps: 0,
      period: 0,
      legMask: 0b1,
      legs: [
        {
          mint: STOCK,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          priceUpdate: POOL,
          route,
        },
      ],
    };
    await expect(
      buildExecuteInstallmentRoutedInstruction({ ...base, protocolFeeBps: 25 }),
    ).rejects.toThrow(/fee recipient/);
    await expect(
      buildExecuteInstallmentRoutedInstruction({ ...base, legMask: 0b11 }),
    ).rejects.toThrow(/does not have/);
    await expect(
      buildExecuteInstallmentRoutedInstruction({ ...base, legs: [] }),
    ).rejects.toThrow(/One leg input/);
    await expect(
      buildExecuteInstallmentRoutedInstruction({
        ...base,
        legs: [{ ...base.legs[0]!, mint: USDC }],
      }),
    ).rejects.toThrow(/does not match/);
    // A 25 bps fee changes amount_in, so the recorded route no longer matches.
    await expect(
      buildExecuteInstallmentRoutedInstruction({
        ...base,
        protocolFeeBps: 25,
        feeRecipient: owner,
      }),
    ).rejects.toThrow(RouteRejected);
    // The plan PDA in a route is refused before signing.
    const planned = {
      ...route,
      accounts: [
        ...route.accounts,
        { address: base.planAddress, role: AccountRole.READONLY },
      ],
    };
    await expect(
      buildExecuteInstallmentRoutedInstruction({
        ...base,
        legs: [{ ...base.legs[0]!, route: planned }],
      }),
    ).rejects.toThrow(/forbidden/);
  });
});

describe("swap authority", () => {
  test("is a PDA of the v1 program, deterministic, with one ATA per mint", async () => {
    const a = await findSwapAuthorityPda();
    expect(await findSwapAuthorityPda()).toBe(a);
    expect(await findSwapAuthorityPda(SUBSCRIPTIONS_PROGRAM_ID)).not.toBe(a);
    const payer = await generateKeyPairSigner();
    const ixs = await swapAuthorityAccountInstructions(payer, [
      { mint: USDC, tokenProgram: TOKEN_PROGRAM_ID },
      { mint: STOCK, tokenProgram: TOKEN_2022_PROGRAM_ID },
      { mint: STOCK, tokenProgram: TOKEN_2022_PROGRAM_ID },
    ]);
    expect(ixs).toHaveLength(2);
    expect(ixs[0]!.accounts![1]!.address).toBe(
      await findAssociatedTokenAddress(a, USDC, TOKEN_PROGRAM_ID),
    );
    expect(Array.from(ixs[1]!.data!)).toEqual([1]);
  });
});
