import { z } from "zod";
import { base58Address as walletSchema } from "@/features/trade/schema";

/** Compliance API contracts, shared by the route handlers and the client (one zod schema). */

export const termsChallengeBodySchema = z.strictObject({
  wallet: walletSchema,
});

export const termsAcceptBodySchema = z.strictObject({
  wallet: walletSchema,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  signature: z.string().min(1).max(100),
  version: z.string().min(1).max(64),
});

export const termsChallengeResponseSchema = z.object({
  nonce: z.string(),
  message: z.string(),
  version: z.string(),
  hash: z.string(),
  expiresAt: z.string(),
});

export const complianceStatusSchema = z.object({
  jurisdiction: z.enum(["allowed", "restricted", "unknown"]),
  trade: z.boolean(),
  browse: z.boolean(),
  terms: z.object({
    version: z.string(),
    hash: z.string(),
    final: z.boolean(),
    accepted: z.boolean().nullable(),
  }),
});
export type ComplianceStatus = z.infer<typeof complianceStatusSchema>;
