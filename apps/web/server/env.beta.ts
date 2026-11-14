import { isAddress } from "@solana/kit";
import { z } from "zod";

/**
 * Phase A private beta variables (REWRITE-PLAN §7.3 W2). Format-checked at boot with the rest of
 * the environment; features/beta/config.ts resolves the defaults (the gate is ON in production
 * unless `off` is set explicitly) and fails closed on anything it cannot read.
 */
export const betaShape = {
  /** `on` | `off`. Unset: on when NODE_ENV or VERCEL_ENV is production, off in development. */
  AROMA_BETA_GATE: z.enum(["on", "off"]).optional(),
  /** Optional allowlist: comma-separated base58 wallet addresses with beta access. */
  AROMA_BETA_WALLETS: z
    .string()
    .refine(
      (value) => {
        const parts = value.split(",").map((part) => part.trim());
        return (
          parts.length <= 500 &&
          parts.every(
            (part) =>
              /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(part) && isAddress(part),
          )
        );
      },
      {
        message:
          "must be comma-separated base58 wallet addresses (at most 500)",
      },
    )
    .optional(),
};
