import { describe, expect, it } from "vitest";
import { GENESIS_HASHES } from "@/server/rpc";
import {
  bundleStatus,
  selectJitoTipLamports,
  sendJitoBundle,
  type BundleReceipt,
} from "./bundle";
import type { MainnetRpc } from "./rpc";

/** Ported from tests/jito-bundles.test.ts. RPC and Jito are injected instead of patching fetch. */
describe("Jito tips", () => {
  it("respect the minimum, a conservative fallback and a hard spending cap", () => {
    expect(selectJitoTipLamports(0.00002)).toBe(20000);
    expect(selectJitoTipLamports(100)).toBe(100000);
    expect(selectJitoTipLamports(0.000000001)).toBe(1000);
    expect(selectJitoTipLamports(undefined)).toBe(10000);
    expect(selectJitoTipLamports(NaN)).toBe(10000);
    expect(selectJitoTipLamports(0.002, 5000)).toBe(5000);
    expect(() => selectJitoTipLamports(0.1, 100001)).toThrow(/between/);
  });
});

const receipt: BundleReceipt = {
  signatures: ["signature1", "signature2"],
  lastValidBlockHeight: 100,
  bundleId: "a".repeat(64),
};
const confirmed = (slot = 40) => ({
  err: null,
  confirmationStatus: "confirmed",
  slot,
});

describe("bundle status", () => {
  it("requires every signature confirmed in one slot; receipt ids never mean Success", async () => {
    let states: unknown[] = [null, null];
    let genesis: string = GENESIS_HASHES["mainnet-beta"];
    let height = 50;
    const methods: string[] = [];
    const rpc: MainnetRpc = async <T>(method: string) => {
      methods.push(method);
      const result =
        method === "getGenesisHash"
          ? genesis
          : method === "getSignatureStatuses"
            ? { value: states }
            : method === "getBlockHeight"
              ? height
              : null;
      return result as T;
    };
    const jito = async <T>(method: string): Promise<T> => {
      methods.push(`jito:${method}`);
      if (method === "sendBundle") return "a".repeat(64) as T;
      return { value: [null] } as T;
    };
    expect(await sendJitoBundle(["signed1", "signed2"], jito)).toBe(
      "a".repeat(64),
    );
    expect((await bundleStatus(receipt, { rpc, jito })).status).toBe("pending");
    states = [confirmed(), confirmed()];
    expect((await bundleStatus(receipt, { rpc, jito })).status).toBe(
      "confirmed",
    );
    states = [confirmed(), null];
    expect((await bundleStatus(receipt, { rpc, jito })).status).toBe("unknown");
    states = [confirmed(40), confirmed(41)];
    expect((await bundleStatus(receipt, { rpc, jito })).status).toBe("unknown");
    states = [
      {
        err: { InstructionError: [1, "Custom"] },
        confirmationStatus: "confirmed",
        slot: 40,
      },
      null,
    ];
    expect((await bundleStatus(receipt, { rpc, jito })).status).toBe("unknown");
    states = [null, null];
    height = 101;
    expect((await bundleStatus(receipt, { rpc, jito })).status).toBe("unknown");
    genesis = "devnet-genesis";
    const count = methods.length;
    await expect(bundleStatus(receipt, { rpc, jito })).rejects.toMatchObject({
      code: "WRONG_CLUSTER",
    });
    expect(methods.slice(count)).toEqual(["getGenesisHash"]);
    expect(methods).not.toContain("sendTransaction");
  });

  it("sendBundle only accepts two to five transactions and a 64-hex receipt", async () => {
    const jito = async <T>(): Promise<T> => "not-a-receipt" as T;
    await expect(sendJitoBundle(["only-one"], jito)).rejects.toThrow();
    await expect(sendJitoBundle(["a", "b"], jito)).rejects.toThrow(
      /invalid receipt/,
    );
  });
});
