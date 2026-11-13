import * as spl from "@solana/spl-token";
import * as web3 from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { MAINNET_SOL_MINT } from "@/lib/sdk/trade/types";
import { prepareQuote } from "./quote";
import {
  ata,
  builder,
  createAta,
  intermediateMint,
  key,
  mintAccount,
  type Route,
} from "./test-harness";

/**
 * Ported from tests/jupiter-intermediate-accounts.test.ts (REWRITE-PLAN §8), against v1
 * `prepareQuote`. Assertions keep the prototype's numbers and error texts (now the logged
 * `detail` of a coded AppError).
 */
for (const [name, tokenProgram] of [
  ["SPL Token", spl.TOKEN_PROGRAM_ID],
  ["plain Token-2022", spl.TOKEN_2022_PROGRAM_ID],
] as const) {
  it(`single swap accepts a route-connected, owner-owned ${name} intermediate ATA`, async () => {
    const run = builder({ tokenProgram });
    const order = await prepareQuote(run.request, run.deps);
    expect(order.quote.inAmount).toBe("1000000");
    expect(order.quote.legs).toHaveLength(1);
    expect(run.calls.intermediateMintReads).toBe(1);
    expect(run.calls.simulations).toBe(1);
  });
}

it("multi-leg basket validates a shared intermediate mint once and includes its ATA in settlement simulation", async () => {
  const run = builder({ basket: true, intermediateBefore: 250 });
  const order = await prepareQuote(run.request, run.deps);
  expect(order.quote.inAmount).toBe("2000000");
  expect(order.quote.legs).toHaveLength(2);
  expect(run.calls.quotes).toBe(2);
  expect(run.calls.intermediateMintReads).toBe(1);
  expect(run.calls.simulations).toBe(1);
});

describe("funding debit review", () => {
  for (const transactionVersion of [0, 1] as const) {
    for (const inputDust of [-50, 1, 11, 100]) {
      it(`V${transactionVersion} review accepts a 20,000 budget with a ${20_000 - inputDust} debit`, async () => {
        const run = builder({
          legInputAmount: 20_000,
          inputDust,
          transactionVersion,
        });
        const order = await prepareQuote(run.request, run.deps);
        expect(order.quote.inAmount).toBe("20000");
        expect(order.quote.legs[0]!.inputAmount).toBe("20000");
        expect(order.quote.legs[0]!.minimumAmount).toBe("990000");
        expect(run.calls.simulations).toBe(1);
        expect(run.calls.authorizedDebit).toBe("20050");
      });
    }
  }

  it("basket review accepts lower spending when all minimum outputs are delivered", async () => {
    const run = builder({ basket: true, inputDust: 11 });
    const order = await prepareQuote(run.request, run.deps);
    expect(order.quote.inAmount).toBe("2000000");
    expect(order.quote.legs.map((leg) => leg.inputAmount)).toEqual([
      "1000000",
      "1000000",
    ]);
  });

  for (const inputDust of [-51, 101, 2_000_000, 2_000_001]) {
    it(`basket review rejects invalid funding difference ${inputDust}`, async () => {
      const run = builder({ basket: true, inputDust });
      await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
        /simulated input debit/,
      );
      expect(run.calls.simulations).toBe(1);
    });
  }

  it("lower spending cannot bypass minimum outputs", async () => {
    const run = builder({ inputDust: 11, outputAmount: 989_999 });
    await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
      /minimum output/,
    );
  });

  it("preparation reserves the extra 50 funding units before requesting routes", async () => {
    const short = builder({ basket: true, fundingBalance: 2_000_000 });
    await expect(prepareQuote(short.request, short.deps)).rejects.toMatchObject(
      { code: "INSUFFICIENT_FUNDS", message: /requires up to 2\.00005/ },
    );
    expect(short.calls.quotes).toBe(0);
    const enough = builder({
      basket: true,
      fundingBalance: 2_000_050,
      inputDust: -50,
    });
    await prepareQuote(enough.request, enough.deps);
    expect(enough.calls.authorizedDebit).toBe("2000050");
  });

  for (const [inputDust, allowed] of [
    [-25, true],
    [-30, false],
    [50, true],
    [51, false],
  ] as const) {
    it(`the whole bundle ${allowed ? "accepts" : "rejects"} a ${-2 * inputDust} unit debit difference`, async () => {
      const run = builder({ basket: true, forceChunks: true, inputDust });
      if (allowed) {
        const order = await prepareQuote(run.request, run.deps);
        expect(order.mode).toBe("bundle");
        expect(order.transactions).toHaveLength(2);
        expect(run.calls.authorizedDebit).toBe("2000050");
      } else {
        await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
          /simulated input debit/,
        );
        expect(run.calls.authorizedDebit).toBeNull();
      }
      expect(run.calls.simulations).toBe(2);
    });
  }

  it("a bundle is refused, with no partial order, when bundles are not configured", async () => {
    const run = builder({ basket: true, forceChunks: true });
    await expect(
      prepareQuote(run.request, { ...run.deps, bundlesEnabled: false }),
    ).rejects.toMatchObject({ code: "BUNDLE_UNAVAILABLE" });
    expect(run.calls.authorizedDebit).toBeNull();
  });

  it("a cheaper basket with one missing constituent still fails review", async () => {
    const run = builder({
      basket: true,
      inputDust: 1_000_000,
      outputAmounts: [1_000_000, 0],
    });
    await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
      /minimum output/,
    );
  });

  it("a lower debit cannot bypass the exact encoded allocation", async () => {
    const run = builder({
      inputDust: 11,
      routeChange: (route) => {
        route.inAmount = "999989";
      },
    });
    await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
      /requested allocation/,
    );
    expect(run.calls.simulations).toBe(0);
  });

  it("lower spending cannot spend an existing intermediate balance", async () => {
    const run = builder({
      inputDust: 11,
      intermediateBefore: 250,
      intermediateAfter: 249,
    });
    await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
      /existing intermediate token balance/,
    );
  });
});

it("native SOL funding supports a token intermediary and preserves the wallet simulation index", async () => {
  const run = builder({ nativeInput: true, intermediateBefore: 250 });
  const order = await prepareQuote(run.request, run.deps);
  expect(order.quote.inputMint).toBe(MAINNET_SOL_MINT);
  expect(order.quote.inAmount).toBe("1000000000");
  expect(order.quote.inputDecimals).toBe(9);
  expect(run.calls.intermediateMintReads).toBe(1);
  expect(run.calls.simulations).toBe(1);
});

it("a negotiated V1 route retains intermediate ATA validation and settlement checks", async () => {
  const run = builder({ transactionVersion: 1 });
  const order = await prepareQuote(run.request, run.deps);
  expect(order.transactionVersion).toBe(1);
  expect(run.calls.intermediateMintReads).toBe(1);
  expect(run.calls.simulations).toBe(1);
});

it("duplicate intermediate ATA setup within a route is composed only once", async () => {
  const run = builder({
    routeChange: (route) => {
      route.setupInstructions.push(
        createAta(intermediateMint, spl.TOKEN_PROGRAM_ID),
      );
    },
  });
  const order = await prepareQuote(run.request, run.deps);
  expect(order.mode).toBe("single");
  const transaction = web3.VersionedTransaction.deserialize(
    Buffer.from(order.transactions[0]!, "base64"),
  );
  const { staticAccountKeys, compiledInstructions } = transaction.message;
  const matchingSetups = compiledInstructions.filter(
    (instruction) =>
      staticAccountKeys[instruction.programIdIndex]!.equals(
        spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      ) &&
      staticAccountKeys[instruction.accountKeyIndexes[1]!]!.toBase58() ===
        ata(intermediateMint),
  );
  expect(matchingSetups).toHaveLength(1);
  expect(run.calls.intermediateMintReads).toBe(1);
  expect(run.calls.simulations).toBe(1);
});

const invalidRoutes: [string, (route: Route) => void][] = [
  ["missing route plan", (route) => void delete route.routePlan],
  [
    "disconnected route plan",
    (route) => {
      route.routePlan![1]!.swapInfo.inputMint = key();
    },
  ],
  [
    "unrelated additional ATA",
    (route) => {
      route.setupInstructions.push(createAta(key(), spl.TOKEN_PROGRAM_ID));
    },
  ],
  [
    "intermediate ATA absent from the swap",
    (route) => void route.swapInstruction.accounts.pop(),
  ],
  [
    "read-only intermediate ATA",
    (route) => {
      route.swapInstruction.accounts.at(-1)!.isWritable = false;
    },
  ],
  [
    "noncanonical ATA address",
    (route) => {
      route.setupInstructions[0]!.accounts[1]!.pubkey = key();
    },
  ],
  [
    "different ATA owner",
    (route) => {
      route.setupInstructions[0]!.accounts[2]!.pubkey = key();
    },
  ],
  [
    "different ATA payer",
    (route) => {
      route.setupInstructions[0]!.accounts[0]!.pubkey = key();
    },
  ],
];
for (const [name, routeChange] of invalidRoutes) {
  it(`${name} is rejected before simulation`, async () => {
    const run = builder({ routeChange });
    await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
      /route|token account|signer|intermediate/i,
    );
    expect(run.calls.simulations).toBe(0);
  });
}

it("an intermediate mint's on-chain token program must match its ATA setup", async () => {
  const run = builder({
    intermediateAccount: mintAccount(spl.TOKEN_2022_PROGRAM_ID),
  });
  await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
    /mint|token program|token account/i,
  );
  expect(run.calls.simulations).toBe(0);
});

it("unsupported Token-2022 intermediate mint extensions fail before simulation", async () => {
  const intermediateAccount = mintAccount(spl.TOKEN_2022_PROGRAM_ID);
  const data = Buffer.alloc(
    spl.getMintLen([spl.ExtensionType.TransferFeeConfig]),
  );
  Buffer.from(intermediateAccount.data[0], "base64").copy(data);
  data[spl.ACCOUNT_SIZE] = spl.AccountType.Mint;
  data.writeUInt16LE(spl.ExtensionType.TransferFeeConfig, spl.ACCOUNT_SIZE + 1);
  data.writeUInt16LE(spl.TRANSFER_FEE_CONFIG_SIZE, spl.ACCOUNT_SIZE + 3);
  intermediateAccount.data = [data.toString("base64"), "base64"];
  const run = builder({
    tokenProgram: spl.TOKEN_2022_PROGRAM_ID,
    intermediateAccount,
  });
  await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
    /extension|mint|token/i,
  );
  expect(run.calls.simulations).toBe(0);
});

for (const name of [
  "missing",
  "non-token",
  "uninitialized",
  "truncated",
] as const) {
  it(`${name} intermediate mint is rejected before simulation`, async () => {
    let account: ReturnType<typeof mintAccount> | null = mintAccount();
    if (name === "missing") account = null;
    else if (name === "non-token")
      account.owner = web3.SystemProgram.programId.toBase58();
    else {
      const data = Buffer.from(account.data[0], "base64");
      if (name === "uninitialized") data[45] = 0;
      account.data = [
        (name === "truncated" ? data.subarray(0, 81) : data).toString("base64"),
        "base64",
      ];
    }
    const run = builder({ intermediateAccount: account });
    await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
      /mint|token|account|initializ/i,
    );
    expect(run.calls.simulations).toBe(0);
  });
}

it("simulation cannot spend a wallet's existing intermediate-token balance", async () => {
  const run = builder({ intermediateBefore: 250, intermediateAfter: 249 });
  await expect(prepareQuote(run.request, run.deps)).rejects.toThrow(
    /intermediate|balance|debit/i,
  );
  expect(run.calls.simulations).toBe(1);
});

describe("v1 quote contents (PRODUCT.md: source, route, price impact, fees, as-of)", () => {
  it("returns the source, per-leg route, price impact, fee breakdown and an as-of time", async () => {
    const run = builder();
    const order = await prepareQuote(run.request, run.deps);
    expect(order.quote.source).toBe("Jupiter");
    expect(order.quote.quotedAt).toBe(
      new Date(1_800_000_000_000).toISOString(),
    );
    expect(order.expiresAt).toBeGreaterThan(1_800_000_000_000);
    expect(order.quote.legs[0]!.priceImpactPct).toBe("0.001");
    expect(order.quote.legs[0]!.hops).toBe(2);
    expect(order.quote.fees.platformFeeBps).toBe(0);
    expect(BigInt(order.quote.fees.baseFeeLamports)).toBe(5000n);
    expect(order.quote.maxDebit).toBe("1000050");
  });
});
