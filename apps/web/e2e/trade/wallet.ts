import { VersionedTransaction } from "@solana/web3.js";
import type { Page } from "@playwright/test";
import { e2eWallet } from "../fork/accounts";

/**
 * TEST-ONLY mocked wallet. The deterministic keypair lives here, in Node test code; the page gets
 * only `window.aromaE2EWallet = { address, sign }`, whose `sign` calls back into this process
 * with base64 bytes. The app's E2E bridge (compiled only into E2E builds) uses it. No key material
 * ever enters the page or any app bundle.
 */
export async function installTestWallet(page: Page): Promise<string> {
  const keypair = e2eWallet();
  const address = keypair.publicKey.toBase58();
  await page.exposeFunction("aromaE2ESign", (unsigned: string[]) =>
    unsigned.map((encoded) => {
      const tx = VersionedTransaction.deserialize(
        Buffer.from(encoded, "base64"),
      );
      tx.sign([keypair]);
      return Buffer.from(tx.serialize()).toString("base64");
    }),
  );
  await page.addInitScript((wallet) => {
    (window as unknown as { aromaE2EWallet: unknown }).aromaE2EWallet = {
      address: wallet,
      sign: (unsigned: string[]) =>
        (
          window as unknown as {
            aromaE2ESign: (u: string[]) => Promise<string[]>;
          }
        ).aromaE2ESign(unsigned),
    };
  }, address);
  return address;
}

/** Sign transactions directly (API-level tests). */
export function signAll(unsigned: string[]): string[] {
  const keypair = e2eWallet();
  return unsigned.map((encoded) => {
    const tx = VersionedTransaction.deserialize(Buffer.from(encoded, "base64"));
    tx.sign([keypair]);
    return Buffer.from(tx.serialize()).toString("base64");
  });
}
