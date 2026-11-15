/**
 * `getProgramAccounts` filters for v1 accounts. Every fixed field of `Plan` precedes `outputs`,
 * so `owner` (offset 9) and `funding_mint` (offset 41) have fixed offsets (ovelo-guard-v1.md).
 */
import {
  getBase58Decoder,
  type Address,
  type Base58EncodedBytes,
} from "@solana/kit";
import { ASSET_DISCRIMINATOR, PLAN_DISCRIMINATOR } from "./generated";

export const PLAN_OWNER_OFFSET = 9n;
export const PLAN_FUNDING_MINT_OFFSET = 41n;

export type MemcmpFilter = {
  memcmp: { offset: bigint; bytes: Base58EncodedBytes; encoding: "base58" };
};

const b58 = (bytes: ArrayLike<number>) =>
  getBase58Decoder().decode(Uint8Array.from(bytes)) as Base58EncodedBytes;

const memcmp = (offset: bigint, bytes: Base58EncodedBytes): MemcmpFilter => ({
  memcmp: { offset, bytes, encoding: "base58" },
});

/** Every v1 plan, or one owner's plans (optionally for one funding mint). */
export function planAccountFilters(
  owner?: Address,
  fundingMint?: Address,
): MemcmpFilter[] {
  const filters = [memcmp(0n, b58(PLAN_DISCRIMINATOR))];
  if (owner)
    filters.push(
      memcmp(PLAN_OWNER_OFFSET, owner as string as Base58EncodedBytes),
    );
  if (fundingMint)
    filters.push(
      memcmp(
        PLAN_FUNDING_MINT_OFFSET,
        fundingMint as string as Base58EncodedBytes,
      ),
    );
  return filters;
}

export function assetAccountFilters(): MemcmpFilter[] {
  return [memcmp(0n, b58(ASSET_DISCRIMINATOR))];
}
