import { z } from "zod";
import { base58Address as walletSchema } from "@/features/trade/schema";

/** Private-beta API contracts, shared by the route handlers and the client (one zod schema). */

const codeSchema = z
  .string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const betaChallengeBodySchema = z.strictObject({
  wallet: walletSchema,
  code: codeSchema,
});

export const betaRedeemBodySchema = z.strictObject({
  wallet: walletSchema,
  code: codeSchema,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  signature: z.string().min(1).max(100),
});

export const betaChallengeResponseSchema = z.object({
  nonce: z.string(),
  message: z.string(),
  expiresAt: z.string(),
});

export const betaRedeemResponseSchema = z.object({
  access: z.literal(true),
  alreadyHadAccess: z.boolean(),
});

export const betaStatusSchema = z.object({
  /** Whether the private-beta gate is on for this deployment. */
  gate: z.boolean(),
  /** For a wallet: whether it may trade (always true with the gate off); null without one. */
  access: z.boolean().nullable(),
});
export type BetaStatus = z.infer<typeof betaStatusSchema>;
