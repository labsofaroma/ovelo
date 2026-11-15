import { z } from "zod";

/**
 * M11 Step 5a fee settings. Accounting only: the platform fee must be 0 (or unset) in this
 * build. A non-zero fee is option 5b (Jupiter platform fee), which needs the owner's and
 * counsel's approval and its own reviewed change to the trade path; until then boot refuses it.
 */
export const feeShape = {
  OVELO_PLATFORM_FEE_BPS: z
    .string()
    .regex(
      /^0$/,
      "must be 0: a platform fee is not approved in this build (M11 5b)",
    )
    .optional(),
  /** The creator's share of the platform fee, recorded in the ledger (0-10000 bps). Default 0. */
  OVELO_CREATOR_FEE_SHARE_BPS: z
    .string()
    .regex(/^\d{1,5}$/, "must be an integer")
    .refine((v) => Number(v) <= 10_000, {
      message: "must be between 0 and 10000",
    })
    .optional(),
};

export type FeeSettings = { platformFeeBps: 0; creatorShareBps: number };

export function feeSettings(
  source: Record<string, string | undefined>,
): FeeSettings {
  const share = Number(source.OVELO_CREATOR_FEE_SHARE_BPS?.trim() || "0");
  return {
    platformFeeBps: 0,
    creatorShareBps:
      Number.isInteger(share) && share >= 0 && share <= 10_000 ? share : 0,
  };
}
