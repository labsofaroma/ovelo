import {
  AccountRole,
  generateKeyPairSigner,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  buildExecuteInstallmentInstruction,
  decodeAssetAccount,
  findAssetPda,
  findAssociatedTokenAddress,
  SYSTEM_PROGRAM_ID,
  type Config,
  type Plan,
} from "@ovelo/guard";
import {
  buildVerifiedPriceUpdates,
  encodedVaaSpace,
  HermesError,
  parseAccumulatorUpdate,
  type HermesLatestUpdates,
} from "@ovelo/guard/pyth";
import type { KeeperRpc } from "./rpc";

/**
 * The transactions of one leg batch (≤ 3 legs, M6): price posts cannot share the execute
 * transaction (a post is ~580 bytes; measured in M7, see docs/keeper-operations.md), so the order
 * is: [token accounts if missing] → VAA prepare (1–2 tx) → one post per feed → execute → cleanup.
 * Every price is a fresh, FULLY verified PriceUpdateV2 that this keeper wrote; the program checks
 * verification level, feed id, staleness and confidence itself.
 */

export type LegInfo = {
  leg: number;
  mint: Address;
  tokenProgram: Address;
  feedId: string;
};

export class HermesUnavailable extends Error {
  constructor(
    readonly kind:
      "stale" | "unauthorized" | "unreachable" | "malformed" | "http",
    message: string,
  ) {
    super(message);
    this.name = "HermesUnavailable";
  }
}

const hex = (bytes: ArrayLike<number>) =>
  "0x" + Buffer.from(Uint8Array.from(bytes)).toString("hex");

export async function legInfos(
  rpc: KeeperRpc,
  plan: Plan,
  legs: readonly number[],
): Promise<LegInfo[]> {
  const out: LegInfo[] = [];
  for (const leg of legs) {
    const output = plan.outputs[leg];
    if (!output) throw new Error(`plan has no leg ${leg}`);
    const { value } = await rpc
      .getAccountInfo(await findAssetPda(output.mint), {
        encoding: "base64",
        commitment: "confirmed",
      })
      .send();
    if (!value) throw new Error(`asset for ${output.mint} is not registered`);
    const asset = decodeAssetAccount(
      Uint8Array.from(Buffer.from(value.data[0], "base64")),
    );
    out.push({
      leg,
      mint: output.mint,
      tokenProgram: asset.tokenProgram,
      feedId: hex(asset.pythFeedId),
    });
  }
  return out;
}

function createAtaIdempotent(
  payer: KeyPairSigner,
  owner: Address,
  mint: Address,
  ata: Address,
  tokenProgram: Address,
): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    accounts: [
      {
        address: payer.address,
        role: AccountRole.WRITABLE_SIGNER,
        signer: payer,
      } as never,
      { address: ata, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ID, role: AccountRole.READONLY },
      { address: tokenProgram, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]),
  };
}

/** The owner's output accounts and the treasury's funding account, when they do not exist yet. */
export async function missingAccounts(
  rpc: KeeperRpc,
  keeper: KeyPairSigner,
  plan: Plan,
  config: Pick<Config, "treasury">,
  legs: readonly LegInfo[],
): Promise<Instruction[]> {
  const wanted: { owner: Address; mint: Address; program: Address }[] = [
    ...legs.map((l) => ({
      owner: plan.owner,
      mint: l.mint,
      program: l.tokenProgram,
    })),
    {
      owner: config.treasury,
      mint: plan.fundingMint,
      program: plan.fundingTokenProgram,
    },
  ];
  const addresses = await Promise.all(
    wanted.map((w) => findAssociatedTokenAddress(w.owner, w.mint, w.program)),
  );
  const { value } = await rpc
    .getMultipleAccounts(addresses, {
      encoding: "base64",
      commitment: "confirmed",
    })
    .send();
  return wanted.flatMap((w, i) =>
    value[i]
      ? []
      : [
          createAtaIdempotent(
            keeper,
            w.owner,
            w.mint,
            addresses[i]!,
            w.program,
          ),
        ],
  );
}

/** Fresh Hermes updates for these feeds, refused when any is older than the staleness bound. */
export async function freshUpdates(
  client: {
    latestUpdates(ids: readonly string[]): Promise<HermesLatestUpdates>;
  },
  feedIds: readonly string[],
  chainNow: bigint,
  maxStalenessSeconds: number,
): Promise<HermesLatestUpdates> {
  let updates: HermesLatestUpdates;
  try {
    updates = await client.latestUpdates(feedIds);
  } catch (error) {
    const kind = error instanceof HermesError ? error.kind : "unreachable";
    throw new HermesUnavailable(
      kind,
      error instanceof Error ? error.message : String(error),
    );
  }
  // Keep a 10-second margin so the posted price is still fresh when execute lands.
  const oldest = chainNow - BigInt(Math.max(1, maxStalenessSeconds - 10));
  const stale = updates.feeds.filter((f) => f.publishTime < oldest);
  const missing = feedIds.filter(
    (id) => !updates.feeds.some((f) => f.id === id.toLowerCase()),
  );
  if (missing.length)
    throw new HermesUnavailable(
      "malformed",
      `Hermes did not return ${missing.join(", ")}`,
    );
  if (stale.length)
    throw new HermesUnavailable(
      "stale",
      `price older than ${maxStalenessSeconds - 10}s for ${stale.map((f) => f.id).join(", ")}`,
    );
  return updates;
}

export type PricePlan = {
  /** Transactions in order: VAA prepare groups, then one post per feed. */
  transactions: Instruction[][];
  cleanup: Instruction[];
  priceUpdateFor: Map<string, Address>;
};

export async function pricePlan(
  rpc: KeeperRpc,
  keeper: KeyPairSigner,
  updates: HermesLatestUpdates,
): Promise<PricePlan> {
  const transactions: Instruction[][] = [];
  const cleanup: Instruction[] = [];
  const priceUpdateFor = new Map<string, Address>();
  for (const accumulator of updates.updates) {
    const parsed = parseAccumulatorUpdate(accumulator);
    const encodedVaa = await generateKeyPairSigner();
    const signers = await Promise.all(
      parsed.updates.map(() => generateKeyPairSigner()),
    );
    const lamports = await rpc
      .getMinimumBalanceForRentExemption(
        BigInt(encodedVaaSpace(parsed.vaa.length)),
      )
      .send();
    const built = await buildVerifiedPriceUpdates({
      payer: keeper,
      writeAuthority: keeper,
      accumulator: parsed,
      encodedVaa,
      encodedVaaLamports: lamports,
      priceUpdateSigners: signers,
      treasuryId: 0,
    });
    transactions.push(...built.prepare, ...built.post.map((ix) => [ix]));
    cleanup.push(...built.cleanup);
    for (const update of built.priceUpdates)
      priceUpdateFor.set(update.feedId.toLowerCase(), update.address);
  }
  return { transactions, cleanup, priceUpdateFor };
}

export async function executeInstruction(input: {
  keeper: KeyPairSigner;
  planAddress: Address;
  plan: Plan;
  config: Pick<Config, "treasury" | "feeRecipient" | "protocolFeeBps">;
  period: number;
  legMask: number;
  legs: readonly LegInfo[];
  priceUpdateFor: ReadonlyMap<string, Address>;
}): Promise<Instruction> {
  return buildExecuteInstallmentInstruction({
    keeper: input.keeper,
    planAddress: input.planAddress,
    plan: input.plan,
    treasury: input.config.treasury,
    feeRecipient:
      input.config.protocolFeeBps > 0 ? input.config.feeRecipient : null,
    period: input.period,
    legMask: input.legMask,
    legs: input.legs.map((l) => {
      const priceUpdate = input.priceUpdateFor.get(l.feedId.toLowerCase());
      if (!priceUpdate) throw new Error(`no posted price for ${l.feedId}`);
      return { mint: l.mint, tokenProgram: l.tokenProgram, priceUpdate };
    }),
  });
}
