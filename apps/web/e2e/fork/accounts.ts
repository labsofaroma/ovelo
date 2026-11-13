import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";

/**
 * TEST-ONLY fork helpers. The E2E wallet is a deterministic keypair that exists only in test code;
 * it is funded ONLY on the local fork (solana-test-validator --account), never on mainnet.
 */
export const E2E_SEED = new Uint8Array(32).fill(77);
export const e2eWallet = (): Keypair => Keypair.fromSeed(E2E_SEED);

export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const BPF_UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111";
/** Programs solana-test-validator already ships (cloning them would conflict). */
export const BUILTINS = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
  "SysvarRent111111111111111111111111111111111",
  "SysvarC1ock11111111111111111111111111111111",
  "Sysvar1nstructions1111111111111111111111111",
  "AddressLookupTab1e1111111111111111111111111",
]);

export type RpcAccount = {
  owner: string;
  executable: boolean;
  lamports: number;
  data: [string, string];
} | null;

export async function rpc<T>(
  url: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const body = (await response.json()) as {
      result?: T;
      error?: { message?: string };
    };
    if (body.error)
      throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
    return body.result as T;
  }
  throw new Error(`${method}: rate limited`);
}

export async function multipleAccounts(
  url: string,
  keys: string[],
): Promise<RpcAccount[]> {
  const out: RpcAccount[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const { value } = await rpc<{ value: RpcAccount[] }>(
      url,
      "getMultipleAccounts",
      [keys.slice(i, i + 100), { encoding: "base64", commitment: "confirmed" }],
    );
    out.push(...value);
  }
  return out;
}

/** Split accounts into upgradeable programs (cloned with their data) and plain accounts. */
export function classify(keys: string[], accounts: RpcAccount[]) {
  const programs: string[] = [];
  const plain: string[] = [];
  keys.forEach((key, i) => {
    const account = accounts[i];
    if (!account || BUILTINS.has(key)) return;
    if (account.executable && account.owner === BPF_UPGRADEABLE)
      programs.push(key);
    else if (!account.executable) plain.push(key);
  });
  return { programs, plain };
}

/** A funded SPL token account for the E2E wallet (written into the fork with --account). */
export function tokenAccountJson(
  mint: string,
  owner: PublicKey,
  amount: bigint,
) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint: new PublicKey(mint),
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  const address = getAssociatedTokenAddressSync(
    new PublicKey(mint),
    owner,
    false,
    TOKEN_PROGRAM_ID,
  );
  return {
    address: address.toBase58(),
    json: {
      pubkey: address.toBase58(),
      account: {
        lamports: 2_039_280,
        data: [data.toString("base64"), "base64"],
        owner: TOKEN_PROGRAM_ID.toBase58(),
        executable: false,
        rentEpoch: 0,
        space: data.length,
      },
    },
  };
}

export function walletJson(owner: PublicKey, lamports: number) {
  return {
    pubkey: owner.toBase58(),
    account: {
      lamports,
      data: ["", "base64"],
      owner: "11111111111111111111111111111111",
      executable: false,
      rentEpoch: 0,
      space: 0,
    },
  };
}
