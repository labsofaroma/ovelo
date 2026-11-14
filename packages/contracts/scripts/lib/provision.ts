/**
 * Idempotent provisioning of the test USD and mock stocks. A mint's keypair is checkpointed to the
 * (git-ignored) state file BEFORE its create transaction, so a timeout resumes with the same mint;
 * an existing mint is validated and never replaced; supply top-ups use exact bigint arithmetic.
 */
import {
  getAddressDecoder,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from "@solana/kit";

export type MintRecord = {
  mint: Address;
  status: "pending" | "created";
  secretKey?: number[];
};
export type ProvisionState = {
  network: "devnet" | "localnet";
  genesisHash: string;
  programId: Address;
  testUsd?: MintRecord;
  assets: Record<string, MintRecord & { registered?: boolean }>;
};

export type MintFacts = {
  owner: Address;
  decimals: number;
  mintAuthority: Address | null;
  freezeAuthority: Address | null;
  isInitialized: boolean;
  scaled: boolean;
};

const keyAt = (data: Uint8Array, at: number): Address | null => {
  const tag = new DataView(data.buffer, data.byteOffset + at, 4).getUint32(
    0,
    true,
  );
  return tag === 0
    ? null
    : getAddressDecoder().decode(data.subarray(at + 4, at + 36));
};

/** Base mint layout (82 bytes) plus whether a ScaledUiAmount TLV entry (type 25) is present. */
export function parseMintFacts(owner: Address, data: Uint8Array): MintFacts {
  if (data.length < 82) throw new Error("Not a mint account.");
  let scaled = false;
  if (data.length > 166 && data[165] === 1) {
    for (let o = 166; o + 4 <= data.length;) {
      const type = data[o]! | (data[o + 1]! << 8);
      const len = data[o + 2]! | (data[o + 3]! << 8);
      if (type === 25) scaled = true;
      if (type === 0 && len === 0) break;
      o += 4 + len;
    }
  }
  return {
    owner,
    mintAuthority: keyAt(data, 0),
    decimals: data[44]!,
    isInitialized: data[45] === 1,
    freezeAuthority: keyAt(data, 46),
    scaled,
  };
}

export type MintSpec = {
  label: string;
  tokenProgram: Address;
  decimals: number;
  mintAuthority: Address;
  scaled: boolean;
};

/** The expected mint authority may depend on the mint address (a per-mint PDA). */
export type MintSpecFor = Omit<MintSpec, "mintAuthority"> & {
  mintAuthority: Address | ((mint: Address) => Promise<Address>);
};

async function resolveSpec(
  spec: MintSpecFor,
  mint: Address,
): Promise<MintSpec> {
  const mintAuthority =
    typeof spec.mintAuthority === "function"
      ? await spec.mintAuthority(mint)
      : spec.mintAuthority;
  return { ...spec, mintAuthority };
}

/** A mint that already exists is reused only if it is exactly what we would create. */
export function validateExistingMint(f: MintFacts, spec: MintSpec): void {
  const problems = [
    f.owner !== spec.tokenProgram &&
      `owned by ${f.owner}, expected ${spec.tokenProgram}`,
    !f.isInitialized && "not initialized",
    f.decimals !== spec.decimals &&
      `decimals ${f.decimals}, expected ${spec.decimals}`,
    f.mintAuthority !== spec.mintAuthority &&
      `mint authority ${f.mintAuthority ?? "none"}, expected ${spec.mintAuthority}`,
    f.freezeAuthority !== null &&
      `has a freeze authority (${f.freezeAuthority})`,
    f.scaled !== spec.scaled &&
      (spec.scaled ? "missing ScaledUiAmount" : "unexpected ScaledUiAmount"),
  ].filter(Boolean);
  if (problems.length)
    throw new Error(
      `${spec.label}: the existing mint will not be replaced: ${problems.join("; ")}.`,
    );
}

/** Tokens to mint so that `current` reaches `target` (never negative). */
export function supplyShortfall(current: bigint, target: bigint): bigint {
  return current >= target ? 0n : target - current;
}

export type ProvisionDeps = {
  readAccount(
    addr: Address,
  ): Promise<{ owner: Address; data: Uint8Array } | null>;
  send(feePayer: TransactionSigner, ixs: Instruction[]): Promise<string>;
  generateMint(): Promise<KeyPairSigner>;
  restoreMint(secretKey: number[]): Promise<KeyPairSigner>;
  exportSecret(mint: KeyPairSigner): Promise<number[]>;
  save(state: ProvisionState): Promise<void>;
};

/**
 * Ensures the mint in `record` exists and matches `spec`. `build` returns the create instructions
 * for a new mint keypair. Returns the updated record (never with a secret once created).
 */
export async function ensureMint(
  deps: ProvisionDeps,
  state: ProvisionState,
  put: (record: MintRecord) => void,
  record: MintRecord | undefined,
  specFor: MintSpecFor,
  payer: TransactionSigner,
  build: (mint: KeyPairSigner) => Promise<Instruction[]>,
): Promise<MintRecord> {
  const spec = { ...specFor, mintAuthority: "" as Address };
  if (record?.status === "created") {
    const account = await deps.readAccount(record.mint);
    if (!account)
      throw new Error(
        `${spec.label}: recorded mint ${record.mint} is missing on chain; refusing to create another. Remove it from the state file to start over.`,
      );
    validateExistingMint(
      parseMintFacts(account.owner, account.data),
      await resolveSpec(specFor, record.mint),
    );
    return record;
  }
  let signer: KeyPairSigner;
  if (record?.status === "pending") {
    if (!record.secretKey)
      throw new Error(
        `${spec.label}: pending record has no keypair; refusing to guess.`,
      );
    signer = await deps.restoreMint(record.secretKey);
    if (signer.address !== record.mint)
      throw new Error(
        `${spec.label}: the state file and its checkpoint disagree.`,
      );
  } else {
    signer = await deps.generateMint();
    put({
      mint: signer.address,
      status: "pending",
      secretKey: await deps.exportSecret(signer),
    });
    await deps.save(state); // checkpoint before any transaction
  }
  const existing = await deps.readAccount(signer.address);
  if (!existing) await deps.send(payer, await build(signer));
  const account = existing ?? (await deps.readAccount(signer.address));
  if (!account)
    throw new Error(`${spec.label}: mint ${signer.address} was not created.`);
  validateExistingMint(
    parseMintFacts(account.owner, account.data),
    await resolveSpec(specFor, signer.address),
  );
  const created: MintRecord = { mint: signer.address, status: "created" };
  put(created);
  await deps.save(state);
  return created;
}
