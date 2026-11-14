import type { CreatorApi, CreatorBasketResponse } from "./api";
import { CreatorApiError } from "./api";
import type { BasketDraftInput, CreatorProfile } from "./schema";

/**
 * The creator publish and archive flows (M5b B2), as plain async functions over injected deps so
 * they are tested without React or a wallet. Each signed request: ask for a challenge, have the
 * wallet sign the exact challenge text (UTF-8 bytes), send the base64 signature with the nonce.
 * The wallet holds the key; this code only passes bytes (AGENTS.md rule 1).
 *
 * States are explicit and optimistic-free: nothing is shown as published until the server says so.
 */
export type FlowStep =
  | { step: "idle" }
  | { step: "challenge"; purpose: "redeem" | "publish" | "delete" }
  | { step: "signing"; purpose: "redeem" | "publish" | "delete" }
  | { step: "submitting"; purpose: "redeem" | "publish" | "delete" }
  | { step: "done" };

export type FlowDeps = {
  api: Pick<CreatorApi, "challenge" | "redeem" | "publish" | "archive">;
  wallet: string;
  /** The connected wallet's message signer; null when it cannot sign messages. */
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | null;
  onStep?: (step: FlowStep) => void;
};

export const UNSUPPORTED_WALLET =
  "This wallet cannot sign messages, so it cannot be used to publish creator baskets. Connect a wallet that supports message signing.";

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** User-safe text for anything the flow can throw. Wallet rejections are not errors to blame. */
export function flowErrorMessage(error: unknown): string {
  if (error instanceof CreatorApiError) return error.message;
  const message = error instanceof Error ? error.message : "";
  if (/reject|denied|declin|cancel/i.test(message))
    return "The signature request was declined in your wallet. Nothing was published.";
  if (message === UNSUPPORTED_WALLET) return message;
  return "The wallet could not sign the request. Nothing was published.";
}

async function sign(
  deps: FlowDeps,
  purpose: "redeem" | "publish" | "delete",
  message: string,
): Promise<string> {
  if (!deps.signMessage) throw new Error(UNSUPPORTED_WALLET);
  deps.onStep?.({ step: "signing", purpose });
  const signature = await deps.signMessage(new TextEncoder().encode(message));
  return toBase64(signature);
}

/** Redeem an invite for the connected wallet (first publish only). */
export async function redeemInvite(
  deps: FlowDeps,
  input: { code: string; profile: CreatorProfile },
): Promise<void> {
  deps.onStep?.({ step: "challenge", purpose: "redeem" });
  const challenge = await deps.api.challenge({
    purpose: "redeem",
    wallet: deps.wallet,
    profile: input.profile,
  });
  const signature = await sign(deps, "redeem", challenge.message);
  deps.onStep?.({ step: "submitting", purpose: "redeem" });
  await deps.api.redeem({
    wallet: deps.wallet,
    nonce: challenge.nonce,
    signature,
    code: input.code,
    profile: input.profile,
  });
}

/**
 * Publish a new basket, or a new version of `basketId` (the server checks ownership). With an
 * invite, it is redeemed first, in the same click, so a new creator signs twice.
 */
export async function publishBasketFlow(
  deps: FlowDeps,
  input: {
    basket: BasketDraftInput;
    basketId?: string;
    invite?: { code: string; profile: CreatorProfile };
  },
): Promise<CreatorBasketResponse["basket"]> {
  if (!deps.signMessage) throw new Error(UNSUPPORTED_WALLET);
  if (input.invite) await redeemInvite(deps, input.invite);
  deps.onStep?.({ step: "challenge", purpose: "publish" });
  const challenge = await deps.api.challenge({
    purpose: "publish",
    wallet: deps.wallet,
    basket: input.basket,
    ...(input.basketId ? { basketId: input.basketId } : {}),
  });
  if (!challenge.basketId)
    throw new CreatorApiError(
      "INVALID_RESPONSE",
      "The server sent an unexpected answer.",
    );
  const signature = await sign(deps, "publish", challenge.message);
  deps.onStep?.({ step: "submitting", purpose: "publish" });
  const { basket } = await deps.api.publish({
    wallet: deps.wallet,
    nonce: challenge.nonce,
    signature,
    basketId: challenge.basketId,
    basket: input.basket,
  });
  deps.onStep?.({ step: "done" });
  return basket;
}

/** Archive a basket (purpose `delete`; the server archives, never deletes). */
export async function archiveBasketFlow(
  deps: FlowDeps,
  basketId: string,
): Promise<CreatorBasketResponse["basket"]> {
  if (!deps.signMessage) throw new Error(UNSUPPORTED_WALLET);
  deps.onStep?.({ step: "challenge", purpose: "delete" });
  const challenge = await deps.api.challenge({
    purpose: "delete",
    wallet: deps.wallet,
    basketId,
  });
  const signature = await sign(deps, "delete", challenge.message);
  deps.onStep?.({ step: "submitting", purpose: "delete" });
  const { basket } = await deps.api.archive(basketId, {
    wallet: deps.wallet,
    nonce: challenge.nonce,
    signature,
  });
  deps.onStep?.({ step: "done" });
  return basket;
}
