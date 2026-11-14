import { createPrivateKey, sign } from "node:crypto";
import * as kit from "@solana/kit";
import type { Page } from "@playwright/test";
import { e2eWallet } from "../fork/accounts";

/**
 * TEST-ONLY mocked wallet. The deterministic keypair lives here, in Node test code; the page gets
 * only `window.aromaE2EWallet = { address, sign }`, whose `sign` calls back into this process
 * with base64 bytes. The app's E2E bridge (compiled only into E2E builds) uses it. No key material
 * ever enters the page or any app bundle. Signing is Ed25519 over the raw message bytes, so V0
 * and V1 transactions are both supported, and so are creator challenge messages (M5b B1).
 */
function testKey() {
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(e2eWallet().secretKey.subarray(0, 32)),
    ]),
    type: "pkcs8",
    format: "der",
  });
}

/** Ed25519 over raw message bytes (creator challenges), base64 in and out. */
export function signMessageBase64(message: string): string {
  return sign(null, Buffer.from(message, "base64"), testKey()).toString(
    "base64",
  );
}

function signOne(encoded: string): string {
  const keypair = e2eWallet();
  const transaction = kit
    .getTransactionDecoder()
    .decode(Buffer.from(encoded, "base64"));
  const signature = sign(
    null,
    Buffer.from(transaction.messageBytes),
    testKey(),
  );
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

export async function installTestWallet(
  page: Page,
  options: { messageDelayMs?: number } = {},
): Promise<string> {
  const address = e2eWallet().publicKey.toBase58();
  await page.exposeFunction("aromaE2ESign", (unsigned: string[]) =>
    unsigned.map(signOne),
  );
  // An optional delay keeps the "confirm in your wallet" state on screen (screenshots).
  await page.exposeFunction("aromaE2ESignMessage", async (message: string) => {
    if (options.messageDelayMs)
      await new Promise((resolve) =>
        setTimeout(resolve, options.messageDelayMs),
      );
    return signMessageBase64(message);
  });
  await page.addInitScript((wallet) => {
    (window as unknown as { aromaE2EWallet: unknown }).aromaE2EWallet = {
      address: wallet,
      sign: (unsigned: string[]) =>
        (
          window as unknown as {
            aromaE2ESign: (u: string[]) => Promise<string[]>;
          }
        ).aromaE2ESign(unsigned),
      signMessage: (message: string) =>
        (
          window as unknown as {
            aromaE2ESignMessage: (m: string) => Promise<string>;
          }
        ).aromaE2ESignMessage(message),
    };
  }, address);
  return address;
}

/** Sign transactions directly (API-level tests). */
export function signAll(unsigned: string[]): string[] {
  return unsigned.map(signOne);
}
