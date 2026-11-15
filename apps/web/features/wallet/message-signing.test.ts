import {
  generateKeyPair,
  getAddressFromPublicKey,
  signBytes,
  verifySignature,
  type SignatureBytes,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import {
  checkedMessageSignature,
  MESSAGE_SIGNING_UNSUPPORTED,
  messageSigner,
  signMessageWithStandard,
  type StandardMessageFeature,
} from "./stack/signing";

/** M5b B1: key-free message signing for creator challenges. */
const message = new TextEncoder().encode(
  "Ovelo: sign to publish a creator basket",
);

/** A Wallet Standard wallet whose key lives only in this test (a stand-in for an extension). */
async function standardWallet(
  tweak?: (out: { signedMessage: Uint8Array; signature: Uint8Array }) => void,
) {
  const keys = await generateKeyPair();
  const address = await getAddressFromPublicKey(keys.publicKey);
  const feature: StandardMessageFeature = {
    signMessage: vi.fn(async (...inputs) =>
      Promise.all(
        inputs.map(async ({ message: bytes }) => {
          const out = {
            signedMessage: bytes,
            signature: new Uint8Array(await signBytes(keys.privateKey, bytes)),
          };
          tweak?.(out);
          return out;
        }),
      ),
    ),
  };
  return { keys, address, feature };
}

describe("message signing", () => {
  it("Wallet Standard solana:signMessage returns a signature that verifies over the raw bytes", async () => {
    const { keys, feature } = await standardWallet();
    const account = { features: ["solana:signMessage"] };
    const signature = await signMessageWithStandard(feature, account, message);
    expect(signature).toHaveLength(64);
    expect(
      await verifySignature(
        keys.publicKey,
        signature as SignatureBytes,
        message,
      ),
    ).toBe(true);
    expect(feature.signMessage).toHaveBeenCalledWith({ account, message });
  });

  it("refuses a wallet that changed (wrapped or prefixed) the message", async () => {
    const { feature } = await standardWallet((out) => {
      out.signedMessage = new Uint8Array([0xff, ...out.signedMessage]);
    });
    await expect(signMessageWithStandard(feature, {}, message)).rejects.toThrow(
      /changed the message/,
    );
  });

  it("refuses a signature that is not 64 bytes", () => {
    expect(() =>
      checkedMessageSignature(message, { signature: new Uint8Array(63) }),
    ).toThrow(/invalid signature/);
    expect(() => checkedMessageSignature(message, undefined)).toThrow(
      /invalid signature/,
    );
  });

  it("a wallet without signMessage is refused with a clear message", async () => {
    await expect(signMessageWithStandard({}, {}, message)).rejects.toThrow(
      MESSAGE_SIGNING_UNSUPPORTED,
    );
    expect(MESSAGE_SIGNING_UNSUPPORTED).toMatch(/cannot sign messages/);
  });

  describe("messageSigner picks the method the wallet declares", () => {
    it("standard first, when the account declares solana:signMessage", async () => {
      const { feature } = await standardWallet();
      const legacy = vi.fn();
      const sign = messageSigner({
        standard: feature,
        account: { features: ["solana:signMessage"] },
        legacy,
      });
      expect(await sign!(message)).toHaveLength(64);
      expect(legacy).not.toHaveBeenCalled();
    });

    it("a legacy adapter's signMessage when the account does not declare the feature", async () => {
      const legacy = vi.fn(async () => new Uint8Array(64).fill(7));
      const sign = messageSigner({
        standard: { signMessage: vi.fn() },
        account: { features: ["solana:signTransaction"] },
        legacy,
      });
      expect(await sign!(message)).toEqual(new Uint8Array(64).fill(7));
      expect(legacy).toHaveBeenCalledWith(message);
    });

    it("validates a legacy adapter's answer too", async () => {
      const sign = messageSigner({ legacy: async () => new Uint8Array(10) });
      await expect(sign!(message)).rejects.toThrow(/invalid signature/);
    });

    it("null when the wallet cannot sign messages at all", () => {
      expect(messageSigner({})).toBeNull();
      expect(
        messageSigner({ account: { features: ["solana:signMessage"] } }),
      ).toBeNull();
    });
  });
});
