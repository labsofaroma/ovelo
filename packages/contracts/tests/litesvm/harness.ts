/**
 * LiteSVM harness for Aroma Guard v1 (devnet-mock build). Loads the pinned Subscriptions and
 * Pyth receiver binaries, deploys the program as an upgradeable program with a known upgrade
 * authority, and drives it through the hand-written v1 builders in `apps/web/lib/sdk/guard/v1`.
 * Every keypair here is generated in memory for one test and never leaves the process.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Clock, FailedTransactionMetadata, LiteSVM } from "litesvm";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from "@solana/kit";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { AccountLayout, MintLayout } from "@solana/spl-token";
import * as v1 from "../../../../apps/web/lib/sdk/guard/v1";

const root = path.resolve(import.meta.dirname, "../..");
export const PROGRAM_DIR =
  process.env.AROMA_V1_PROGRAM_DIR ?? path.join(root, "target/test-programs");
const pins = JSON.parse(
  fs.readFileSync(
    path.join(root, "tests/fixtures/runtime-programs.json"),
    "utf8",
  ),
) as {
  programs: Record<string, { programId: string; sha256: string }>;
};
export const GUARD_SO =
  process.env.AROMA_V1_GUARD_SO ??
  path.join(root, "target/build/devnet-mock/aroma_guard.so");
export const MAINNET_SO = path.join(
  root,
  "target/build/mainnet/aroma_guard.so",
);
export const LOADER = v1.BPF_LOADER_UPGRADEABLE_ID;
const enc = getAddressEncoder();

export const START = 1_800_000_000n; // clock origin for every test

function pinned(name: string): Uint8Array {
  const bytes = fs.readFileSync(path.join(PROGRAM_DIR, `${name}.so`));
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== pins.programs[name]?.sha256)
    throw new Error(`${name}.so is not the pinned binary; run test:fixtures.`);
  return bytes;
}

/** Bytes of a web3.js instruction as a kit instruction; `signers` supply signing accounts. */
export function kitIx(
  ix: TransactionInstruction,
  signers: TransactionSigner[] = [],
): Instruction {
  return {
    programAddress: address(ix.programId.toBase58()),
    accounts: ix.keys.map((k) => {
      const addr = address(k.pubkey.toBase58());
      const signer = signers.find((s) => s.address === addr);
      const role = k.isSigner
        ? k.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : k.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY;
      return signer ? { address: addr, role, signer } : { address: addr, role };
    }),
    data: new Uint8Array(ix.data),
  };
}

export const pk = (a: Address) => new PublicKey(a);

export class Env {
  svm: LiteSVM;
  now = START;
  slot = 1_000n;
  private constructor(svm: LiteSVM) {
    this.svm = svm;
  }

  static async create(
    upgradeAuthority: Address | null,
    soPath = GUARD_SO,
  ): Promise<Env> {
    const svm = new LiteSVM();
    svm.addProgram(
      address(pins.programs.subscriptions!.programId),
      pinned("subscriptions"),
    );
    svm.addProgram(
      address(pins.programs.pyth_receiver!.programId),
      pinned("pyth_receiver"),
    );
    const env = new Env(svm);
    await env.deployUpgradeable(
      v1.AROMA_GUARD_V1_PROGRAM_ID,
      fs.readFileSync(soPath),
      upgradeAuthority,
    );
    env.setClock(START);
    return env;
  }

  /** Program + ProgramData accounts as the upgradeable loader writes them. */
  async deployUpgradeable(
    programId: Address,
    elf: Uint8Array,
    authority: Address | null,
  ) {
    const programData = await v1.findProgramDataAddress(programId);
    const pd = new Uint8Array(45 + elf.length);
    new DataView(pd.buffer).setUint32(0, 3, true);
    if (authority) {
      pd[12] = 1;
      pd.set(enc.encode(authority), 13);
    }
    pd.set(elf, 45);
    this.put(programData, LOADER, pd);
    const prog = new Uint8Array(36);
    new DataView(prog.buffer).setUint32(0, 2, true);
    prog.set(enc.encode(programData), 4);
    this.put(programId, LOADER, prog, true);
  }

  put(
    addr: Address,
    owner: Address,
    data: Uint8Array,
    executable = false,
    extraLamports = 0n,
  ) {
    this.svm.setAccount({
      address: addr,
      programAddress: owner,
      data,
      executable,
      lamports: lamports(
        this.svm.minimumBalanceForRentExemption(BigInt(data.length)) +
          extraLamports,
      ),
      space: BigInt(data.length),
    });
  }

  setClock(unix: bigint) {
    this.now = unix;
    this.slot += 10n;
    this.svm.setClock(new Clock(this.slot, 0n, 0n, 0n, unix));
    this.svm.expireBlockhash();
  }

  async signer(sol = 10n): Promise<KeyPairSigner> {
    const s = await generateKeyPairSigner();
    this.svm.airdrop(s.address, lamports(sol * 1_000_000_000n));
    return s;
  }

  data(addr: Address): Uint8Array | null {
    const account = this.svm.getAccount(addr);
    return account.exists ? new Uint8Array(account.data) : null;
  }

  lamportsOf(addr: Address): bigint {
    const account = this.svm.getAccount(addr);
    return account.exists ? BigInt(account.lamports) : 0n;
  }

  tokenAmount(addr: Address): bigint {
    const data = this.data(addr);
    if (!data) throw new Error(`Token account missing: ${addr}`);
    return AccountLayout.decode(
      Buffer.from(data.subarray(0, AccountLayout.span)),
    ).amount;
  }

  tokenDelegate(addr: Address): Address | null {
    const data = this.data(addr);
    if (!data) return null;
    const decoded = AccountLayout.decode(
      Buffer.from(data.subarray(0, AccountLayout.span)),
    );
    return decoded.delegateOption ? address(decoded.delegate.toBase58()) : null;
  }

  /** Sends one transaction; returns the logs or throws with them. */
  async send(
    feePayer: TransactionSigner,
    instructions: Instruction[],
  ): Promise<string[]> {
    const result = await this.trySend(feePayer, instructions);
    if (!result.ok) throw new Error(result.logs.join("\n"));
    return result.logs;
  }

  async trySend(feePayer: TransactionSigner, instructions: Instruction[]) {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(feePayer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: this.svm.latestBlockhash(),
            lastValidBlockHeight: 1_000_000n,
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const tx = await signTransactionMessageWithSigners(message);
    const result = this.svm.sendTransaction(tx);
    this.svm.expireBlockhash();
    if (result instanceof FailedTransactionMetadata) {
      return {
        ok: false as const,
        logs: result.meta().logs(),
        error: String(result.err()),
      };
    }
    return { ok: true as const, logs: result.logs(), error: "" };
  }

  /** A classic SPL mint written directly (6 dp test USD and similar). */
  classicMint(
    mint: Address,
    decimals: number,
    mintAuthority: Address | null,
    freeze: Address | null = null,
  ) {
    const data = Buffer.alloc(MintLayout.span);
    MintLayout.encode(
      {
        mintAuthorityOption: mintAuthority ? 1 : 0,
        mintAuthority: mintAuthority ? pk(mintAuthority) : PublicKey.default,
        supply: 0n,
        decimals,
        isInitialized: true,
        freezeAuthorityOption: freeze ? 1 : 0,
        freezeAuthority: freeze ? pk(freeze) : PublicKey.default,
      },
      data,
    );
    this.put(mint, v1.TOKEN_PROGRAM_ID, data);
  }

  /** A classic token account written directly at its associated address. */
  async classicAta(
    owner: Address,
    mint: Address,
    amount: bigint,
    delegate: Address | null = null,
  ) {
    const ata = await v1.findAssociatedTokenAddress(
      owner,
      mint,
      v1.TOKEN_PROGRAM_ID,
    );
    const data = Buffer.alloc(AccountLayout.span);
    AccountLayout.encode(
      {
        mint: pk(mint),
        owner: pk(owner),
        amount,
        delegateOption: delegate ? 1 : 0,
        delegate: delegate ? pk(delegate) : PublicKey.default,
        state: 1,
        isNativeOption: 0,
        isNative: 0n,
        delegatedAmount: delegate ? 2n ** 64n - 1n : 0n,
        closeAuthorityOption: 0,
        closeAuthority: PublicKey.default,
      },
      data,
    );
    this.put(ata, v1.TOKEN_PROGRAM_ID, data);
    return ata;
  }
}

const PRICE_UPDATE_DISCRIMINATOR = crypto
  .createHash("sha256")
  .update("account:PriceUpdateV2")
  .digest()
  .subarray(0, 8);

export type PriceInput = {
  feedId: Uint8Array;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: bigint;
  full?: boolean;
};

/** `PriceUpdateV2` bytes as the Pyth receiver writes them (Full = 1 byte, Partial = 2 bytes). */
export function priceUpdateBytes(p: PriceInput): Uint8Array {
  const full = p.full ?? true;
  const out = Buffer.alloc(
    8 + 32 + (full ? 1 : 2) + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8,
  );
  let o = 0;
  PRICE_UPDATE_DISCRIMINATOR.copy(out, o);
  o += 8 + 32; // write authority left zero
  if (full) out[o++] = 1;
  else {
    out[o++] = 0;
    out[o++] = 5;
  }
  Buffer.from(p.feedId).copy(out, o);
  o += 32;
  out.writeBigInt64LE(p.price, o);
  o += 8;
  out.writeBigUInt64LE(p.conf, o);
  o += 8;
  out.writeInt32LE(p.expo, o);
  o += 4;
  out.writeBigInt64LE(p.publishTime, o);
  o += 8;
  out.writeBigInt64LE(p.publishTime - 1n, o);
  o += 8;
  out.writeBigInt64LE(p.price, o);
  o += 8;
  out.writeBigUInt64LE(p.conf, o);
  o += 8;
  out.writeBigUInt64LE(1n, o);
  return out;
}

export const feed = (byte: number) => new Uint8Array(32).fill(byte);
