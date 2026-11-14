import { describe, expect, it } from "vitest";
import { tradeOutcome } from "./outcome";
import type { TradeRecord } from "./store";

/** W3: settling a stale cap reservation from the chain (read-only calls; "open" = keep counting). */
const record = (over: Partial<TradeRecord> = {}): TradeRecord => ({
  id: "r",
  taker: "t",
  mode: "single",
  transactionVersion: 0,
  signatures: ["sig"],
  bundleId: null,
  status: "pending",
  lastValidBlockHeight: 100,
  receipt: {} as TradeRecord["receipt"],
  submittedAt: "",
  updatedAt: "",
  slot: null,
  error: null,
  ...over,
});
function deps(
  found: TradeRecord | null,
  chain: { status?: unknown; height?: number; fail?: boolean },
) {
  return {
    store: { get: async () => found } as never,
    rpc: (async (method: string) => {
      if (chain.fail) throw new Error("rpc down");
      if (method === "getSignatureStatuses")
        return { value: [chain.status ?? null] };
      return chain.height ?? 0;
    }) as never,
  };
}

describe("tradeOutcome", () => {
  it("no record (never claimed) and a failed record are failed; confirmed is confirmed", async () => {
    expect(await tradeOutcome("r", deps(null, {}))).toBe("failed");
    expect(
      await tradeOutcome("r", deps(record({ status: "failed" }), {})),
    ).toBe("failed");
    expect(
      await tradeOutcome("r", deps(record({ status: "confirmed" }), {})),
    ).toBe("confirmed");
  });

  it("reads the chain for pending, unknown and submitting records", async () => {
    for (const status of ["pending", "unknown", "submitting"] as const) {
      const r = record({ status });
      expect(
        await tradeOutcome(
          "r",
          deps(r, { status: { err: null, confirmationStatus: "finalized" } }),
        ),
      ).toBe("confirmed");
      expect(
        await tradeOutcome(
          "r",
          deps(r, {
            status: { err: { x: 1 }, confirmationStatus: "confirmed" },
          }),
        ),
      ).toBe("failed");
      expect(
        await tradeOutcome(
          "r",
          deps(r, { status: { err: null, confirmationStatus: "processed" } }),
        ),
      ).toBe("open");
    }
  });

  it("no status: failed only once the chain is past the last valid block height", async () => {
    expect(await tradeOutcome("r", deps(record(), { height: 101 }))).toBe(
      "failed",
    );
    expect(await tradeOutcome("r", deps(record(), { height: 100 }))).toBe(
      "open",
    );
  });

  it("long past the expiry a missing status proves nothing: open (the amount keeps counting)", async () => {
    expect(await tradeOutcome("r", deps(record(), { height: 100 + 150 }))).toBe(
      "failed",
    );
    expect(await tradeOutcome("r", deps(record(), { height: 100 + 151 }))).toBe(
      "open",
    );
  });

  it("an RPC failure keeps it open (fail closed: the amount keeps counting)", async () => {
    expect(await tradeOutcome("r", deps(record(), { fail: true }))).toBe(
      "open",
    );
  });
});
