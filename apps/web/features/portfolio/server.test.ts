import { describe, expect, it } from "vitest";
import { GENESIS_HASHES } from "@/server/rpc";
import { toMarketsView } from "../markets/normalize";
import { mint, snapshot } from "../test/fixtures";
import type { MainnetRpc } from "../trade/server/rpc";
import { getPortfolio, toActivity } from "./server";

const WALLET = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const view = toMarketsView(snapshot());

function tokenAccount(tokenMint: string, amount: string, decimals: number) {
  return {
    account: {
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      data: {
        parsed: {
          type: "account",
          info: {
            mint: tokenMint,
            owner: WALLET,
            state: "initialized",
            tokenAmount: { amount, decimals, uiAmountString: null },
          },
        },
      },
    },
  };
}

function rpc(genesis: string = GENESIS_HASHES["mainnet-beta"]): MainnetRpc {
  return async <T>(method: string, params: unknown[] = []): Promise<T> => {
    if (method === "getGenesisHash") return genesis as T;
    if (method === "getBalance") return { value: 2_500_000_000 } as T;
    if (method === "getTokenAccountsByOwner") {
      const program = (params[1] as { programId: string }).programId;
      return {
        value: program.startsWith("Tokenkeg")
          ? [
              tokenAccount(mint(1), "150000000", 8), // 1.5 TESTx at 101.25
              tokenAccount(mint(3), "100000000", 8), // NOPx: no token price
              tokenAccount(mint(88), "5", 0), // not in the catalog
              tokenAccount(mint(2), "0", 8), // empty: hidden
            ]
          : [],
      } as T;
    }
    throw new Error(method);
  };
}

describe("getPortfolio", () => {
  it("values catalog holdings exactly and leaves unpriced ones unvalued", async () => {
    const out = await getPortfolio(WALLET, {
      rpc: rpc(),
      markets: async () => view,
      now: () => 0,
    });
    expect(out.sol).toEqual({ raw: "2500000000", decimals: 9 });
    const test = out.holdings.find((h) => h.symbol === "TESTx")!;
    expect(test.value).toEqual({ raw: "151875000", decimals: 6 }); // $151.875
    expect(test.priceSource).toBeTruthy();
    expect(out.holdings.find((h) => h.symbol === "NOPx")!.value).toBeNull();
    expect(out.holdings.find((h) => !h.catalog)!.symbol).toBe("Unknown token");
    expect(out.holdings).toHaveLength(3);
    expect(out.unpricedCount).toBe(2);
    expect(out.pricesAsOf).toBe(view.asOf);
    expect(out.sources[0]).toBe("Solana mainnet RPC balances");
  });

  it("without prices it still shows balances, with a warning and no values", async () => {
    const out = await getPortfolio(WALLET, {
      rpc: rpc(),
      markets: async () => null,
    });
    expect(out.holdings.every((h) => h.value === null)).toBe(true);
    expect(out.warnings[0]).toMatch(/unavailable/);
    expect(out.pricedValue.raw).toBe("0");
  });

  it("refuses a non-mainnet RPC", async () => {
    await expect(
      getPortfolio(WALLET, {
        rpc: rpc(GENESIS_HASHES.devnet),
        markets: async () => view,
      }),
    ).rejects.toMatchObject({ code: "WRONG_CLUSTER" });
  });
});

describe("toActivity", () => {
  it("maps receipts without inventing anything", () => {
    const [item] = toActivity([
      {
        signature: "sig",
        wallet: WALLET,
        kind: "basket",
        amountIn: "1000000",
        mintIn: mint(5),
        legs: [
          {
            mint: mint(1),
            outAmount: "5",
            minimumAmount: "4",
            basket: "sol-core",
          },
        ],
        slot: 1n,
        blockTime: null,
        status: "confirmed",
        createdAt: new Date(0),
      },
    ]);
    expect(item).toMatchObject({
      basket: "sol-core",
      blockTime: null,
      status: "confirmed",
      amountIn: "1000000",
    });
  });
});
