import {
  generateKeyPair,
  getAddressFromPublicKey,
  signBytes,
} from "@solana/kit";
import type { ChallengeStore } from "../auth/creator";

/** In-memory stand-in for the two Redis commands the challenge store uses. */
export function memoryStore(): ChallengeStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async set(key, value, options) {
      if (options.nx && data.has(key)) return null;
      data.set(key, value);
      return "OK";
    },
    async getdel(key) {
      const value = data.get(key) ?? null;
      data.delete(key);
      return value;
    },
  };
}

/**
 * A throwaway test wallet: a fresh, non-extractable WebCrypto Ed25519 key that lives only in this
 * process. It plays the role of the user's wallet; server code never sees the private key.
 */
export async function makeSigner() {
  const keys = await generateKeyPair();
  const wallet: string = await getAddressFromPublicKey(keys.publicKey);
  return {
    wallet,
    async sign(message: string): Promise<string> {
      const bytes = await signBytes(
        keys.privateKey,
        new TextEncoder().encode(message),
      );
      return Buffer.from(bytes).toString("base64");
    },
  };
}
