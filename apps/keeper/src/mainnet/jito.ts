import {
  AccountRole,
  address,
  getU64Encoder,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";

/**
 * Optional Jito path (M8 B5): a tip transfer appended to the transaction and submission through
 * the block engine's `sendTransaction` JSON-RPC. Simulation and confirmation still use the
 * genesis-checked RPC. Off unless KEEPER_JITO_URL is set.
 */

/** Jito's published mainnet tip accounts. */
export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
].map((a) => address(a));

const SYSTEM = address("11111111111111111111111111111111");

export function jitoTipInstruction(
  payer: KeyPairSigner,
  lamports: bigint,
  pick = Math.random(),
): Instruction {
  const to =
    JITO_TIP_ACCOUNTS[
      Math.floor(pick * JITO_TIP_ACCOUNTS.length) % JITO_TIP_ACCOUNTS.length
    ]!;
  const data = new Uint8Array(12);
  data.set([2, 0, 0, 0], 0); // SystemInstruction::Transfer
  data.set(getU64Encoder().encode(lamports), 4);
  return {
    programAddress: SYSTEM,
    accounts: [
      {
        address: payer.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: payer,
      } as never,
      { address: to, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

export function jitoSubmitter(url: string, get: typeof fetch = fetch) {
  return async (wireBase64: string): Promise<Signature> => {
    const response = await get(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [wireBase64, { encoding: "base64" }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as {
      result?: string;
      error?: { message?: string };
    } | null;
    if (!response.ok || !body?.result)
      throw new Error(
        `Jito sendTransaction failed: ${body?.error?.message ?? response.status}`,
      );
    return body.result as Signature;
  };
}
