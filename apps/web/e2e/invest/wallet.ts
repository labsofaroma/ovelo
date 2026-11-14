import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import * as kit from "@solana/kit";
import type { Page } from "@playwright/test";

/**
 * TEST-ONLY wallet for the invest E2E. The key is generated at runtime by the localnet chain
 * script (.e2e-invest/state.json, git-ignored) and stays in this Node process; the page only gets
 * `window.aromaE2EWallet` with an address and callbacks (the M4 bridge pattern).
 */
export type InvestState = {
  rpcUrl: string;
  genesis: string;
  programId: string;
  testUsd: string;
  stocks: { symbol: string; mint: string; feedId: string }[];
  hermesUrl: string;
  keeper: { address: string; secret: number[] };
  faucet: { address: string; secret: number[] };
  wallet: { address: string; secret: number[] };
  walletB: { address: string; secret: number[] };
  treasury: string;
};

export const state = (): InvestState =>
  JSON.parse(readFileSync(process.env.E2E_INVEST_STATE ?? "", "utf8")) as InvestState;

const keyOf = (secret: number[]) =>
  createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(secret.slice(0, 32))]),
    type: "pkcs8",
    format: "der",
  });

export function signTransaction(secret: number[], address: string, encoded: string): string {
  const tx = kit.getTransactionDecoder().decode(Buffer.from(encoded, "base64"));
  const signature = sign(null, Buffer.from(tx.messageBytes), keyOf(secret));
  return Buffer.from(
    kit.getTransactionEncoder().encode({
      ...tx,
      signatures: { ...tx.signatures, [kit.address(address)]: signature as unknown as kit.SignatureBytes },
    }),
  ).toString("base64");
}

export async function installWallet(page: Page, who: { address: string; secret: number[] }, chains?: string[]): Promise<void> {
  await page.exposeFunction("aromaE2ESign", (unsigned: string[]) => unsigned.map((u) => signTransaction(who.secret, who.address, u)));
  await page.exposeFunction("aromaE2ESignMessage", (message: string) =>
    sign(null, Buffer.from(message, "base64"), keyOf(who.secret)).toString("base64"),
  );
  await page.addInitScript(
    ({ address, chains }) => {
      const w = window as unknown as {
        aromaE2ESign: (u: string[]) => Promise<string[]>;
        aromaE2ESignMessage: (m: string) => Promise<string>;
        aromaE2EWallet: unknown;
      };
      w.aromaE2EWallet = { address, chains, sign: (u: string[]) => w.aromaE2ESign(u), signMessage: (m: string) => w.aromaE2ESignMessage(m) };
    },
    { address: who.address, chains },
  );
}
