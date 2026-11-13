import "server-only";
import { z } from "zod";
import {
  type ChallengePurpose,
  verifyChallenge,
  walletSchema,
} from "@/server/auth/creator";
import { expectedOrigin, type CreatorDeps } from "./http";
import { inviteCodeSchema } from "./invites";
import {
  basketDraftSchema,
  basketIdSchema,
  basketPublishSchema,
  type BasketDraft,
  type CreatorProfile,
  creatorProfileSchema,
  describeBasket,
} from "./schema";

/** Request bodies of the creator API (REWRITE-PLAN §5.4). Server-only: wallets use @solana/kit. */

export const challengeBodySchema = z.discriminatedUnion("purpose", [
  z.strictObject({
    purpose: z.literal("publish"),
    wallet: walletSchema,
    basketId: basketIdSchema.optional(),
    basket: basketPublishSchema,
  }),
  z.strictObject({
    purpose: z.literal("update"),
    wallet: walletSchema,
    basketId: basketIdSchema.optional(),
    basket: basketDraftSchema,
  }),
  z.strictObject({
    purpose: z.literal("delete"),
    wallet: walletSchema,
    basketId: basketIdSchema,
  }),
  z.strictObject({
    purpose: z.literal("redeem"),
    wallet: walletSchema,
    profile: creatorProfileSchema,
  }),
]);

const signed = {
  wallet: walletSchema,
  nonce: z.string().max(64),
  signature: z.string().max(100),
};

export const redeemBodySchema = z.strictObject({
  ...signed,
  code: inviteCodeSchema,
  profile: creatorProfileSchema,
});

export const basketBodySchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...signed,
    action: z.literal("publish"),
    basketId: basketIdSchema,
    basket: basketPublishSchema,
  }),
  z.strictObject({
    ...signed,
    action: z.literal("save"),
    basketId: basketIdSchema,
    basket: basketDraftSchema,
  }),
]);

export const archiveBodySchema = z.strictObject(signed);

/** What a purpose signs over: the parsed content, and the lines the wallet shows for it. */
export function signedContent(
  input:
    | { purpose: "publish" | "update"; basket: BasketDraft }
    | { purpose: "delete" }
    | { purpose: "redeem"; profile: CreatorProfile },
): { content: unknown; summary: string[] } {
  switch (input.purpose) {
    case "publish":
    case "update":
      return { content: input.basket, summary: describeBasket(input.basket) };
    case "delete":
      return { content: null, summary: [] };
    case "redeem":
      return {
        content: input.profile,
        summary: [
          `Display name: ${input.profile.displayName}`,
          ...(input.profile.social ? [`Profile: ${input.profile.social}`] : []),
        ],
      };
  }
}

/** Verify a signed request against its challenge; consumes the nonce. */
export function verifySigned(
  deps: CreatorDeps,
  request: Request,
  body: { wallet: string; nonce: string; signature: string },
  purpose: ChallengePurpose,
  basketId: string | null,
  signedInput: { content: unknown; summary: string[] },
) {
  return verifyChallenge(
    deps.challenges(),
    {
      origin: expectedOrigin(request),
      wallet: body.wallet,
      purpose,
      basketId,
      ...signedInput,
      nonce: body.nonce,
      signature: body.signature,
    },
    { now: deps.now().getTime() },
  );
}
