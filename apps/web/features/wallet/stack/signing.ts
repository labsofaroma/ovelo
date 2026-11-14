import type { TransactionVersion } from "../context";

/**
 * Pure signing helpers for the wallet bridge (ported from components/trading/TradingAuth.tsx).
 * Wallet Standard `solana:signTransaction` takes raw bytes, so it signs V0 and V1 alike; only
 * versions the wallet explicitly ADVERTISES are used. Nothing here can read a private key.
 */

export const MAINNET_CHAIN = "solana:mainnet";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const NON_MAINNET = /^solana:(devnet|testnet|localnet)$/;

export function decode(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}
export function encode(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** Only versions advertised by the signing method we actually call (0 and/or 1). */
export function advertisedVersions(
  versions: readonly unknown[] | undefined,
  canSign: boolean,
): TransactionVersion[] {
  if (!canSign || !Array.isArray(versions)) return [];
  return ([0, 1] as const).filter((version) =>
    versions.some((value) => value === version || value === String(version)),
  );
}

/** A Wallet Standard account that only declares non-mainnet chains is refused. */
export function accountOnMainnet(
  chains: readonly string[] | undefined,
): boolean {
  if (!chains || chains.length === 0) return true;
  if (chains.includes(MAINNET_CHAIN)) return true;
  return !chains.some((chain) => NON_MAINNET.test(chain));
}

export type StandardSignFeature = {
  supportedTransactionVersions?: readonly (number | string)[];
  signTransaction?: (
    ...inputs: { account: unknown; chain: string; transaction: Uint8Array }[]
  ) => Promise<readonly { signedTransaction: Uint8Array }[]>;
};

export async function signWithStandard(
  feature: StandardSignFeature,
  account: unknown,
  unsigned: readonly string[],
): Promise<string[]> {
  if (!feature.signTransaction)
    throw new Error("This wallet cannot sign transactions.");
  const signed = await feature.signTransaction(
    ...unsigned.map((tx) => ({
      account,
      chain: MAINNET_CHAIN,
      transaction: decode(tx),
    })),
  );
  if (signed.length !== unsigned.length)
    throw new Error("The wallet did not sign every reviewed transaction.");
  return signed.map((item) => encode(item.signedTransaction));
}

/** The browser RPC must report mainnet's genesis; devnet (or anything else) is refused. */
export async function rpcIsMainnet(
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }),
    });
    const body = (await response.json()) as { result?: unknown };
    return body.result === MAINNET_GENESIS;
  } catch {
    return false;
  }
}

export function assertCanSign(
  supported: readonly TransactionVersion[],
  version: TransactionVersion,
  count: number,
): void {
  if (count < 1 || count > 5)
    throw new Error("Review between one and five transactions.");
  if (!supported.includes(version))
    throw new Error(
      `This wallet has not advertised v${version} transaction signing.`,
    );
}

/* ------------------------------------------------------------ message signing (M5b B1) */

export const MESSAGE_SIGNING_UNSUPPORTED =
  "This wallet cannot sign messages, so it cannot be used to publish creator baskets. Connect a wallet that supports message signing.";

/** Wallet Standard `solana:signMessage` (raw bytes in, raw Ed25519 signature out). */
export type StandardMessageFeature = {
  signMessage?: (
    ...inputs: { account: unknown; message: Uint8Array }[]
  ) => Promise<
    readonly { signedMessage?: Uint8Array; signature: Uint8Array }[]
  >;
};

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * A wallet's answer is untrusted: the signature must be exactly 64 bytes, and if the wallet
 * reports what it signed, it must be the exact message (some wallets wrap or prefix messages,
 * and the server verifies over the raw bytes, so a wrapped signature would never verify).
 */
export function checkedMessageSignature(
  message: Uint8Array,
  output: { signedMessage?: Uint8Array; signature?: Uint8Array } | undefined,
): Uint8Array {
  const signature = output?.signature;
  if (!(signature instanceof Uint8Array) || signature.length !== 64)
    throw new Error("The wallet returned an invalid signature.");
  if (
    output?.signedMessage instanceof Uint8Array &&
    !sameBytes(output.signedMessage, message)
  )
    throw new Error(
      "The wallet changed the message before signing it, so the signature cannot be used.",
    );
  return signature;
}

export async function signMessageWithStandard(
  feature: StandardMessageFeature,
  account: unknown,
  message: Uint8Array,
): Promise<Uint8Array> {
  if (!feature.signMessage) throw new Error(MESSAGE_SIGNING_UNSUPPORTED);
  const [output] = await feature.signMessage({ account, message });
  return checkedMessageSignature(message, output);
}

/**
 * Pick the message signer for a connected wallet: Wallet Standard `solana:signMessage` when the
 * account declares it, else a legacy adapter's `signMessage`, else null (the wallet cannot
 * publish; callers show MESSAGE_SIGNING_UNSUPPORTED).
 */
export function messageSigner(input: {
  standard?: StandardMessageFeature;
  account?: { features?: readonly string[] };
  legacy?: (message: Uint8Array) => Promise<Uint8Array>;
}): ((message: Uint8Array) => Promise<Uint8Array>) | null {
  const { standard, account, legacy } = input;
  if (
    standard?.signMessage &&
    account?.features?.includes("solana:signMessage")
  )
    return (message) => signMessageWithStandard(standard, account, message);
  if (legacy)
    return async (message) =>
      checkedMessageSignature(message, { signature: await legacy(message) });
  return null;
}
