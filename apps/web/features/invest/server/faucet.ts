import "server-only";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import {
  AccountRole,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

type SignedInstruction = {
  programAddress: Address;
  accounts: readonly (AccountMeta | AccountSignerMeta)[];
  data: Uint8Array;
};
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  findAssociatedTokenAddress,
  SYSTEM_PROGRAM_ID,
} from "@ovelo/guard";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  faucetMessage,
  type FaucetRequest,
  type FaucetResponse,
} from "../schema";
import { readAccount, readMint } from "./chain";
import type { InvestNetwork, InvestRpc } from "./cluster";
import { claimFaucet, type FaucetRedis } from "./faucet-limits";
import { sendAndConfirm } from "./transactions";
import { verifyTurnstile } from "./turnstile";

/**
 * POST /api/v1/faucet (B6, closes AUDIT H-5 for v1): devnet (or the localnet test build) only.
 * The faucet key is a devnet-only server secret that holds the TEST USD mint authority (never
 * the deployer: init-devnet refuses that). It mints a small fixed amount and tops up a little
 * SOL when the wallet is low. Order: wallet signature → Turnstile → Redis limits → chain checks
 * (genesis, mint authority) → send. Every error is logged and surfaced.
 */

/** 100 test USD (6 decimals). */
export const FAUCET_TEST_USD_RAW = 100_000_000n;
/** 0.05 SOL, sent only when the wallet holds less than that. */
export const FAUCET_LAMPORTS = 50_000_000n;
export const CLAIM_MAX_AGE_SECONDS = 300n;

export type FaucetDeps = {
  network: InvestNetwork;
  rpc: InvestRpc;
  redis: FaucetRedis;
  faucetKey: Uint8Array;
  turnstileSecret: string;
  dailyClaims: number;
  ip: string;
  now?: () => Date;
  fetch?: typeof fetch;
  confirm?: typeof sendAndConfirm;
};

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyClaimSignature(
  request: Pick<FaucetRequest, "wallet" | "issuedAt" | "signature">,
  cluster: InvestNetwork["cluster"],
  nowSeconds: bigint,
): void {
  const age = nowSeconds - BigInt(request.issuedAt);
  if (age < -60n || age > CLAIM_MAX_AGE_SECONDS)
    throw new AppError("UNAUTHORIZED", {
      publicMessage: "The signed claim expired. Sign it again.",
      detail: `claim age ${age}s`,
    });
  const key = createPublicKey({
    key: Buffer.concat([
      ED25519_SPKI_PREFIX,
      Buffer.from(getAddressEncoder().encode(request.wallet as Address)),
    ]),
    format: "der",
    type: "spki",
  });
  const message = Buffer.from(
    faucetMessage(request.wallet, request.issuedAt, cluster),
  );
  if (
    !verifySignature(
      null,
      message,
      key,
      Buffer.from(request.signature, "base64"),
    )
  )
    throw new AppError("SIGNATURE_INVALID", {
      detail: "faucet claim signature",
    });
}

/** The mint's `COption<Pubkey>` mint authority (u32 tag, then 32 bytes) equals `signer`. */
export function isMintAuthority(data: Uint8Array, signer: Address): boolean {
  if (data.length < 82 || Buffer.from(data.subarray(0, 4)).readUInt32LE() !== 1)
    return false;
  return Buffer.from(data.subarray(4, 36)).equals(
    Buffer.from(getAddressEncoder().encode(signer)),
  );
}

function u64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function faucetInstructions(input: {
  faucet: KeyPairSigner;
  wallet: Address;
  ata: Address;
  mint: Address;
  tokenProgram: Address;
  lamports: bigint;
}): SignedInstruction[] {
  const { faucet, wallet, ata, mint, tokenProgram } = input;
  const ixs: SignedInstruction[] = [
    {
      // Associated Token Account program: CreateIdempotent (1).
      programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
      accounts: [
        {
          address: faucet.address,
          role: AccountRole.WRITABLE_SIGNER,
          signer: faucet,
        },
        { address: ata, role: AccountRole.WRITABLE },
        { address: wallet, role: AccountRole.READONLY },
        { address: mint, role: AccountRole.READONLY },
        { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
        { address: tokenProgram, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([1]),
    },
    {
      // SPL Token MintTo (7): the faucet key is the test USD mint authority.
      programAddress: tokenProgram,
      accounts: [
        { address: mint, role: AccountRole.WRITABLE },
        { address: ata, role: AccountRole.WRITABLE },
        {
          address: faucet.address,
          role: AccountRole.READONLY_SIGNER,
          signer: faucet,
        },
      ],
      data: new Uint8Array([7, ...u64(FAUCET_TEST_USD_RAW)]),
    },
  ];
  if (input.lamports > 0n)
    ixs.push({
      // System program Transfer (2).
      programAddress: SYSTEM_PROGRAM_ID,
      accounts: [
        {
          address: faucet.address,
          role: AccountRole.WRITABLE_SIGNER,
          signer: faucet,
        },
        { address: wallet, role: AccountRole.WRITABLE },
      ],
      data: new Uint8Array([2, 0, 0, 0, ...u64(input.lamports)]),
    });
  return ixs;
}

export async function claimTestTokens(
  deps: FaucetDeps,
  request: FaucetRequest,
): Promise<FaucetResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const wallet = request.wallet as Address;
  verifyClaimSignature(
    request,
    deps.network.cluster,
    BigInt(Math.floor(now.getTime() / 1000)),
  );
  await verifyTurnstile({
    secret: deps.turnstileSecret,
    token: request.turnstileToken,
    remoteIp: deps.ip,
    fetch: deps.fetch,
  });
  const claim = await claimFaucet(deps.redis, {
    wallet,
    ip: deps.ip,
    dailyClaims: deps.dailyClaims,
    now,
  });
  try {
    const faucet = await createKeyPairSignerFromBytes(deps.faucetKey);
    if (faucet.address === wallet)
      throw new AppError("FORBIDDEN", { detail: "faucet cannot pay itself" });
    const mintAddress = deps.network.deployment.fundingMint;
    const [mintAccount, mint, walletAccount] = await Promise.all([
      readAccount(deps.rpc, mintAddress),
      readMint(deps.rpc, mintAddress),
      readAccount(deps.rpc, wallet),
    ]);
    if (!mintAccount || !isMintAuthority(mintAccount.data, faucet.address))
      throw new AppError("SERVICE_UNAVAILABLE", {
        publicMessage: "The test faucet is not configured right now.",
        detail: "faucet key is not the test USD mint authority",
      });
    const lamports =
      (walletAccount?.lamports ?? 0n) < FAUCET_LAMPORTS ? FAUCET_LAMPORTS : 0n;
    const ata = await findAssociatedTokenAddress(
      wallet,
      mintAddress,
      mint.tokenProgram,
    );
    const { value: blockhash } = await deps.rpc
      .getLatestBlockhash({ commitment: "confirmed" })
      .send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(faucet, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) =>
        appendTransactionMessageInstructions(
          faucetInstructions({
            faucet,
            wallet,
            ata,
            mint: mintAddress,
            tokenProgram: mint.tokenProgram,
            lamports,
          }),
          m,
        ),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const confirmed = await (deps.confirm ?? sendAndConfirm)(
      deps.rpc,
      getBase64EncodedWireTransaction(signed),
      blockhash.lastValidBlockHeight,
    );
    logger.info(
      {
        wallet,
        signature: confirmed.signature,
        lamports: lamports.toString(),
        cluster: deps.network.cluster,
      },
      "faucet claim sent",
    );
    return {
      wallet,
      testUsdRaw: FAUCET_TEST_USD_RAW.toString(),
      lamports: lamports.toString(),
      signature: confirmed.signature,
      cluster: deps.network.cluster,
    };
  } catch (error) {
    logger.error(
      { err: error, wallet },
      "faucet claim failed; limits released",
    );
    await claim.release();
    throw error;
  }
}
