import { describe, expect, it, vi } from "vitest";
import {
  accountOnMainnet,
  advertisedVersions,
  assertCanSign,
  decode,
  encode,
  MAINNET_GENESIS,
  rpcIsMainnet,
  signWithStandard,
} from "./stack/signing";

describe("wallet signing helpers", () => {
  it("only versions the signing method advertises are used", () => {
    expect(advertisedVersions([0, "1", "legacy"], true)).toEqual([0, 1]);
    expect(advertisedVersions(["legacy"], true)).toEqual([]);
    expect(advertisedVersions([0, 1], false)).toEqual([]);
    expect(advertisedVersions(undefined, true)).toEqual([]);
  });

  it("refuses accounts that only declare devnet or testnet", () => {
    expect(accountOnMainnet(["solana:devnet"])).toBe(false);
    expect(accountOnMainnet(["solana:testnet", "solana:devnet"])).toBe(false);
    expect(accountOnMainnet(["solana:mainnet", "solana:devnet"])).toBe(true);
    expect(accountOnMainnet(undefined)).toBe(true);
  });

  it("the browser RPC must report mainnet's genesis (devnet is refused)", async () => {
    const answer = (result: unknown) =>
      vi.fn(async () => Response.json({ result })) as unknown as typeof fetch;
    expect(await rpcIsMainnet("https://rpc", answer(MAINNET_GENESIS))).toBe(
      true,
    );
    expect(
      await rpcIsMainnet(
        "https://rpc",
        answer("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"),
      ),
    ).toBe(false);
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await rpcIsMainnet("https://rpc", offline)).toBe(false);
  });

  it("signs raw bytes through Wallet Standard on mainnet and checks the count", async () => {
    const tx = encode(new Uint8Array([1, 2, 3]));
    expect(decode(tx)).toEqual(new Uint8Array([1, 2, 3]));
    const feature = {
      signTransaction: vi.fn(
        async (...inputs: { chain: string; transaction: Uint8Array }[]) => {
          expect(inputs.every((i) => i.chain === "solana:mainnet")).toBe(true);
          return inputs.map((i) => ({
            signedTransaction: new Uint8Array([...i.transaction, 9]),
          }));
        },
      ),
    };
    expect(await signWithStandard(feature, {}, [tx])).toEqual([
      encode(new Uint8Array([1, 2, 3, 9])),
    ]);
    const short = { signTransaction: async () => [] };
    await expect(signWithStandard(short, {}, [tx])).rejects.toThrow(
      /every reviewed/,
    );
    await expect(signWithStandard({}, {}, [tx])).rejects.toThrow(/cannot sign/);
  });

  it("refuses unadvertised versions and more than five transactions", () => {
    expect(() => assertCanSign([0], 1, 1)).toThrow(/v1/);
    expect(() => assertCanSign([0, 1], 0, 6)).toThrow(/one and five/);
    expect(() => assertCanSign([0], 0, 1)).not.toThrow();
  });
});
