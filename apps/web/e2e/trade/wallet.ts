import { createPrivateKey, sign } from "node:crypto";
import * as kit from "@solana/kit";
import type { Page } from "@playwright/test";
import { e2eWallet } from "../fork/accounts";

/**
 * TEST-ONLY mocked wallet. The deterministic keypair lives here, in Node test code; the page gets
 * only `window.aromaE2EWallet = { address, sign }`, whose `sign` calls back into this process
 * with base64 bytes. The app's E2E bridge (compiled only into E2E builds) uses it. No key material
 * ever enters the page or any app bundle. Signing is Ed25519 over the raw message bytes, so V0
 * and V1 transactions are both supported.
 */
function signOne(encoded: string): string {
  const keypair = e2eWallet();
  const transaction = kit
    .getTransactionDecoder()
    .decode(Buffer.from(encoded, "base64"));
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]),
    type: "pkcs8",
    format: "der",
  });
  const signature = sign(null, Buffer.from(transaction.messageBytes), key);
  return Buffer.from(
    kit.getTransactionEncoder().encode({
      ...transaction,
      signatures: {
        ...transaction.signatures,
        [kit.address(keypair.publicKey.toBase58())]:
          signature as unknown as kit.SignatureBytes,
      },
    }),
  ).toString("base64");
}

export async function installTestWallet(page: Page): Promise<string> {
  const address = e2eWallet().publicKey.toBase58();
  await page.exposeFunction("aromaE2ESign", (unsigned: string[]) =>
    unsigned.map(signOne),
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
  return unsigned.map(signOne);
}
