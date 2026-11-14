import "server-only";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  challengeMessage,
  issueChallenge,
  verifyChallenge,
  type ChallengeStore,
} from "@/server/auth/creator";
import { AppError } from "@/server/errors";
import type { CompliancePolicy } from "../policy";
import { termsVersion as findTerms } from "../terms";

/**
 * Terms acceptance before the first trade (M9 compliance gate, C3). The M5 challenge pattern,
 * purpose `terms`: the server issues a single-use nonce bound to the site, the wallet and the
 * CURRENT terms version + SHA-256; the wallet signs the human-readable message (signMessage);
 * the server consumes the nonce (GETDEL), verifies the Ed25519 signature and stores the row.
 * A quote then needs a stored acceptance of the current version AND hash: a version bump (or a
 * text edit under the same id) makes every wallet accept again.
 */

export type TermsAcceptanceRow = {
  wallet: string;
  termsVersion: string;
  termsHash: string;
  message: string;
  signature: string;
  nonce: string;
  country: string | null;
};

export type TermsStore = {
  /** Insert; a second row for the same wallet + version + hash is ignored (idempotent). */
  insert(row: TermsAcceptanceRow): Promise<void>;
  accepted(wallet: string, version: string, hash: string): Promise<boolean>;
};

export type TermsDeps = {
  store(): TermsStore;
  challenges(): ChallengeStore;
  policy(): CompliancePolicy;
  now(): Date;
};

export function termsHash(version: string): string {
  const terms = findTerms(version);
  if (!terms)
    throw new AppError("INTERNAL", { detail: "unknown terms version" });
  return createHash("sha256")
    .update(canonicalJson(terms.document), "utf8")
    .digest("hex");
}

export function currentTerms(policy: CompliancePolicy) {
  const version = policy.termsVersion;
  const terms = findTerms(version)!;
  return { version, hash: termsHash(version), final: terms.final };
}

/** What the wallet signs over (hashed into the challenge) and the lines it shows. */
function signedTerms(version: string, hash: string) {
  return {
    content: { termsHash: hash, termsVersion: version },
    summary: [
      `Terms version: ${version}`,
      `Terms text: sha256:${hash}`,
      // Placeholder acceptance line: needs counsel's final text (COMPLIANCE.md §4).
      "I have read and accept these terms and the risk disclosures.",
    ],
  };
}

export async function issueTermsChallenge(
  deps: TermsDeps,
  input: { origin: string; wallet: string },
) {
  const { version, hash } = currentTerms(deps.policy());
  const { payload, message } = await issueChallenge(
    deps.challenges(),
    {
      origin: input.origin,
      wallet: input.wallet,
      purpose: "terms",
      basketId: null,
      ...signedTerms(version, hash),
    },
    { now: deps.now().getTime() },
  );
  return {
    nonce: payload.nonce,
    message,
    version,
    hash,
    expiresAt: payload.expiresAt,
  };
}

export async function acceptTerms(
  deps: TermsDeps,
  input: {
    origin: string;
    wallet: string;
    nonce: string;
    signature: string;
    version: string;
    country: string | null;
  },
): Promise<{ version: string; hash: string }> {
  const { version, hash } = currentTerms(deps.policy());
  // An acceptance of an older (or unknown) version is refused before the nonce is spent.
  if (input.version !== version)
    throw new AppError("CONFLICT", {
      publicMessage:
        "These terms are no longer current. Review the current terms and sign again.",
      detail: "terms version mismatch",
    });
  const signed = signedTerms(version, hash);
  const payload = await verifyChallenge(
    deps.challenges(),
    {
      origin: input.origin,
      wallet: input.wallet,
      purpose: "terms",
      basketId: null,
      ...signed,
      nonce: input.nonce,
      signature: input.signature,
    },
    { now: deps.now().getTime() },
  );
  await deps.store().insert({
    wallet: input.wallet,
    termsVersion: version,
    termsHash: hash,
    message: challengeMessage(payload, signed.summary),
    signature: input.signature,
    nonce: input.nonce,
    country: input.country,
  });
  return { version, hash };
}

export async function termsStatus(deps: TermsDeps, wallet: string) {
  const { version, hash, final } = currentTerms(deps.policy());
  return {
    version,
    hash,
    final,
    accepted: await deps.store().accepted(wallet, version, hash),
  };
}

/** The quote gate: a stored acceptance of the CURRENT version and hash, or TERMS_REQUIRED. */
export async function assertTermsAccepted(
  deps: TermsDeps,
  wallet: string,
  publicMessage?: string,
): Promise<void> {
  const { version, hash } = currentTerms(deps.policy());
  if (!(await deps.store().accepted(wallet, version, hash)))
    throw new AppError("TERMS_REQUIRED", {
      publicMessage,
      detail: `terms ${version} not accepted`,
    });
}
