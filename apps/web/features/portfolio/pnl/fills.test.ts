import { describe, expect, it, vi } from "vitest";
import { fillsFromTransaction, loadFills, type FillCache } from "./fills";

const W = "Wallet1111111111111111111111111111111111111";
const bal = (mint: string, owner: string, amount: string) => ({
  mint,
  owner,
  uiTokenAmount: { amount },
});

describe("exact fills from a confirmed transaction", () => {
  it("is the wallet's positive token-balance change per mint; other owners and outflows ignored", () => {
    const tx = {
      meta: {
        err: null,
        preTokenBalances: [
          bal("A", W, "5"),
          bal("USDC", W, "100"),
          bal("A", "pool", "999"),
        ],
        postTokenBalances: [
          bal("A", W, "12"),
          bal("B", W, "3"),
          bal("USDC", W, "40"),
          bal("A", "pool", "1"),
        ],
      },
    };
    expect(fillsFromTransaction(tx, W)).toEqual({ A: "7", B: "3" });
  });

  it("a failed transaction delivered nothing; an unreadable answer is null (unknown)", () => {
    expect(
      fillsFromTransaction(
        { meta: { err: { InstructionError: [0, "x"] } } },
        W,
      ),
    ).toEqual({});
    expect(fillsFromTransaction(null, W)).toBeNull();
    expect(
      fillsFromTransaction(
        { meta: { err: null, postTokenBalances: [{ bad: 1 }] } },
        W,
      ),
    ).toBeNull();
  });

  it("reads at most maxReads uncached transactions per call and caches what it read", async () => {
    const store = new Map<string, Record<string, string>>([
      ["cached", { A: "1" }],
    ]);
    const cache: FillCache = {
      get: async (s) => store.get(s) ?? null,
      set: async (s, f) => void store.set(s, f),
    };
    const read = vi.fn(async () => ({
      meta: {
        err: null,
        preTokenBalances: [],
        postTokenBalances: [bal("A", W, "2")],
      },
    }));
    const out = await loadFills(["cached", "s1", "s2", "s3"], W, {
      cache,
      read,
      maxReads: 2,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect([...out.keys()]).toEqual(["cached", "s1", "s2"]);
    expect(store.has("s1")).toBe(true);
  });
});
