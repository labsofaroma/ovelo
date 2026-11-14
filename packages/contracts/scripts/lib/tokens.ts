/** Token instructions for provisioning, built with @solana/spl-token and converted to kit. */
import {
  AccountRole,
  address,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createInitializeScaledUiAmountConfigInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from "@solana/spl-token";

export const pk = (a: Address) => new PublicKey(a);

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

/** Classic SPL mint (test USD): mint authority = `authority`, no freeze authority. */
export function createClassicMintIxs(
  payer: TransactionSigner,
  mint: TransactionSigner,
  decimals: number,
  authority: Address,
  rent: bigint,
) {
  return [
    kitIx(
      SystemProgram.createAccount({
        fromPubkey: pk(payer.address),
        newAccountPubkey: pk(mint.address),
        space: 82,
        lamports: Number(rent),
        programId: TOKEN_PROGRAM_ID,
      }),
      [payer, mint],
    ),
    kitIx(
      createInitializeMint2Instruction(
        pk(mint.address),
        decimals,
        pk(authority),
        null,
        TOKEN_PROGRAM_ID,
      ),
    ),
  ];
}

export const SCALED_MINT_SPACE = getMintLen([
  ExtensionType.ScaledUiAmountConfig,
]);

/** Token-2022 mock stock with ScaledUiAmount; mint authority = the asset's mock PDA, no freeze. */
export function createMockStockIxs(
  payer: TransactionSigner,
  mint: TransactionSigner,
  decimals: number,
  mockAuthority: Address,
  multiplier: number,
  rent: bigint,
) {
  return [
    kitIx(
      SystemProgram.createAccount({
        fromPubkey: pk(payer.address),
        newAccountPubkey: pk(mint.address),
        space: SCALED_MINT_SPACE,
        lamports: Number(rent),
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      [payer, mint],
    ),
    kitIx(
      createInitializeScaledUiAmountConfigInstruction(
        pk(mint.address),
        pk(payer.address),
        multiplier,
        TOKEN_2022_PROGRAM_ID,
      ),
    ),
    kitIx(
      createInitializeMint2Instruction(
        pk(mint.address),
        decimals,
        pk(mockAuthority),
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    ),
  ];
}

export function ataAddress(
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Address {
  return address(
    getAssociatedTokenAddressSync(
      pk(mint),
      pk(owner),
      true,
      pk(tokenProgram),
    ).toBase58(),
  );
}

export function ataIx(
  payer: TransactionSigner,
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Instruction {
  const ata = getAssociatedTokenAddressSync(
    pk(mint),
    pk(owner),
    true,
    pk(tokenProgram),
  );
  return kitIx(
    createAssociatedTokenAccountIdempotentInstruction(
      pk(payer.address),
      ata,
      pk(owner),
      pk(mint),
      pk(tokenProgram),
    ),
    [payer],
  );
}

export function mintToIx(
  mint: Address,
  destination: Address,
  authority: TransactionSigner,
  amount: bigint,
): Instruction {
  return kitIx(
    createMintToInstruction(
      pk(mint),
      pk(destination),
      pk(authority.address),
      amount,
      [],
      TOKEN_PROGRAM_ID,
    ),
    [authority],
  );
}
