import "server-only";
import type { Address, Base64EncodedBytes } from "@solana/kit";
import {
  assetAccountFilters,
  decodeAssetAccount,
  decodeConfigAccount,
  decodePlanAccount,
  findConfigPda,
  findSubscriptionAuthorityPda,
  planAccountFilters,
  SUBSCRIPTIONS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  type Asset,
  type Config,
  type Plan,
} from "@aroma/guard";
import { getSubscriptionAuthorityDecoder } from "@solana/subscriptions";
import { AppError } from "@/server/errors";
import type { InvestRpc } from "./cluster";

/**
 * Chain reads for the invest feature. The chain is the source of truth: plans_index and receipts
 * are caches (B4). Every decode is checked (discriminator and version) by the v1 decoders.
 */

const bytes = (
  data: readonly [string, "base64"] | readonly [Base64EncodedBytes, "base64"],
) => Uint8Array.from(Buffer.from(data[0], "base64"));

export type AccountRead = {
  address: Address;
  owner: Address;
  lamports: bigint;
  data: Uint8Array;
};

export async function readAccount(
  rpc: InvestRpc,
  address: Address,
): Promise<AccountRead | null> {
  const { value } = await rpc
    .getAccountInfo(address, { encoding: "base64", commitment: "confirmed" })
    .send();
  if (!value) return null;
  return {
    address,
    owner: value.owner,
    lamports: value.lamports,
    data: bytes(value.data),
  };
}

export async function readConfig(rpc: InvestRpc): Promise<Config> {
  const account = await readAccount(rpc, await findConfigPda());
  if (!account)
    throw new AppError("INVEST_UNAVAILABLE", {
      detail: "config account missing",
    });
  return decodeConfigAccount(account.data);
}

export type RegisteredAsset = { address: Address; asset: Asset };

export async function readAssets(
  rpc: InvestRpc,
  programId: Address,
): Promise<RegisteredAsset[]> {
  const accounts = await rpc
    .getProgramAccounts(programId, {
      encoding: "base64",
      commitment: "confirmed",
      filters: assetAccountFilters(),
    })
    .send();
  const out: RegisteredAsset[] = [];
  for (const item of accounts) {
    try {
      out.push({
        address: item.pubkey,
        asset: decodeAssetAccount(bytes(item.account.data)),
      });
    } catch {
      // A malformed account is never offered; the index would only mislead.
    }
  }
  return out;
}

export type PlanRead = { address: Address; plan: Plan; lamports: bigint };

/** One owner's plans (memcmp on discriminator + owner at offset 9). */
export async function readPlansByOwner(
  rpc: InvestRpc,
  programId: Address,
  owner?: Address,
): Promise<PlanRead[]> {
  const accounts = await rpc
    .getProgramAccounts(programId, {
      encoding: "base64",
      commitment: "confirmed",
      filters: planAccountFilters(owner),
    })
    .send();
  const plans: PlanRead[] = [];
  for (const item of accounts) {
    if (item.account.owner !== programId) continue;
    try {
      const plan = decodePlanAccount(bytes(item.account.data));
      if (owner && plan.owner !== owner) continue;
      plans.push({
        address: item.pubkey,
        plan,
        lamports: item.account.lamports,
      });
    } catch {
      // Skip anything that does not decode as a v1 plan.
    }
  }
  return plans;
}

export async function readPlan(
  rpc: InvestRpc,
  programId: Address,
  address: Address,
): Promise<PlanRead | null> {
  const account = await readAccount(rpc, address);
  if (!account || account.owner !== programId) return null;
  return {
    address,
    plan: decodePlanAccount(account.data),
    lamports: account.lamports,
  };
}

/**
 * The owner's Subscriptions authority for a mint: `null` when it does not exist yet (create_plan
 * then creates it in the same transaction), else its current `initId`.
 */
export async function readSubscriptionAuthorityInitId(
  rpc: InvestRpc,
  owner: Address,
  mint: Address,
): Promise<bigint | null> {
  const address = await findSubscriptionAuthorityPda(owner, mint);
  const { value } = await rpc
    .getAccountInfo(address, { encoding: "base64", commitment: "confirmed" })
    .send();
  if (!value) return null;
  if (value.owner !== SUBSCRIPTIONS_PROGRAM_ID)
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: "subscription authority has a foreign owner",
    });
  return getSubscriptionAuthorityDecoder().decode(bytes(value.data)).initId;
}

/** Chain time (unix seconds) from the latest confirmed block; never the server clock. */
export async function chainNow(rpc: InvestRpc): Promise<bigint> {
  const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
  const time = await rpc.getBlockTime(slot).send();
  if (time === null)
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: "block time unavailable",
    });
  return BigInt(time);
}

export type MintInfo = { tokenProgram: Address; decimals: number };

/** Decimals and token program from the mint account itself (offset 44). */
export async function readMint(
  rpc: InvestRpc,
  mint: Address,
): Promise<MintInfo> {
  const account = await readAccount(rpc, mint);
  if (
    !account ||
    (account.owner !== TOKEN_PROGRAM_ID &&
      account.owner !== TOKEN_2022_PROGRAM_ID) ||
    account.data.length < 82 ||
    account.data[45] !== 1
  )
    throw new AppError("ASSET_UNAVAILABLE", {
      detail: `mint ${mint} missing or invalid`,
    });
  return { tokenProgram: account.owner, decimals: account.data[44]! };
}

/** Raw token balance of a token account (0 when it does not exist). */
export async function readTokenBalance(
  rpc: InvestRpc,
  tokenAccount: Address,
): Promise<bigint> {
  const account = await readAccount(rpc, tokenAccount);
  if (!account || account.data.length < 72) return 0n;
  return Buffer.from(account.data.subarray(64, 72)).readBigUInt64LE();
}
