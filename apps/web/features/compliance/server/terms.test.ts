import { describe, expect, it } from "vitest";
import { makeSigner, memoryStore } from "@/server/test/creator-fixtures";
import { loadPolicy, type CompliancePolicy } from "../policy";
import { memoryTermsStore } from "./store";
import {
  acceptTerms,
  assertTermsAccepted,
  issueTermsChallenge,
  termsHash,
  termsStatus,
  type TermsDeps,
} from "./terms";
import { TERMS_VERSIONS } from "../terms";

const ORIGIN = "https://aroma.example";
const NOW = new Date("2026-11-14T10:00:00.000Z");

function deps(overrides: Partial<TermsDeps> = {}) {
  const store = memoryTermsStore();
  const challenges = memoryStore();
  let policy: CompliancePolicy = loadPolicy({});
  const d: TermsDeps & { setPolicy(p: CompliancePolicy): void } = {
    store: () => store,
    challenges: () => challenges,
    policy: () => policy,
    now: () => NOW,
    setPolicy: (p) => (policy = p),
    ...overrides,
  };
  return { d, store };
}

async function signedAcceptance(
  d: TermsDeps,
  signer: Awaited<ReturnType<typeof makeSigner>>,
) {
  const challenge = await issueTermsChallenge(d, {
    origin: ORIGIN,
    wallet: signer.wallet,
  });
  return {
    challenge,
    input: {
      origin: ORIGIN,
      wallet: signer.wallet,
      nonce: challenge.nonce,
      signature: await signer.sign(challenge.message),
      version: challenge.version,
      country: "DE",
    },
  };
}

describe("terms acceptance (purpose `terms`, the M5 challenge pattern)", () => {
  it("the challenge names the terms version and the SHA-256 of their text, and moves no funds", async () => {
    const { d } = deps();
    const signer = await makeSigner();
    const { challenge } = await issueTermsChallenge(d, {
      origin: ORIGIN,
      wallet: signer.wallet,
    }).then((c) => ({ challenge: c }));
    expect(challenge.hash).toBe(termsHash(challenge.version));
    expect(challenge.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.message).toContain(
      "Aroma: sign to accept Aroma's terms of use",
    );
    expect(challenge.message).toContain(`Terms version: ${challenge.version}`);
    expect(challenge.message).toContain(`Terms text: sha256:${challenge.hash}`);
    expect(challenge.message).toContain(`Wallet: ${signer.wallet}`);
    expect(challenge.message).toMatch(/does not move funds/);
  });

  it("a valid signature stores the acceptance with the exact signed message; the gate then passes", async () => {
    const { d, store } = deps();
    const signer = await makeSigner();
    await expect(assertTermsAccepted(d, signer.wallet)).rejects.toMatchObject({
      code: "TERMS_REQUIRED",
    });
    const { challenge, input } = await signedAcceptance(d, signer);
    await expect(acceptTerms(d, input)).resolves.toEqual({
      version: challenge.version,
      hash: challenge.hash,
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      wallet: signer.wallet,
      termsVersion: challenge.version,
      termsHash: challenge.hash,
      message: challenge.message,
      country: "DE",
    });
    await expect(
      assertTermsAccepted(d, signer.wallet),
    ).resolves.toBeUndefined();
    expect((await termsStatus(d, signer.wallet)).accepted).toBe(true);
  });

  it("replay: the same signed acceptance works once (the nonce is consumed)", async () => {
    const { d } = deps();
    const signer = await makeSigner();
    const { input } = await signedAcceptance(d, signer);
    await acceptTerms(d, input);
    await expect(acceptTerms(d, input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      detail: "unknown-or-used-nonce",
    });
  });

  it("wrong wallet: a signature by another wallet, or a challenge for another wallet, is refused", async () => {
    const { d, store } = deps();
    const alice = await makeSigner();
    const mallory = await makeSigner();
    // Mallory signs Alice's challenge.
    const challenge = await issueTermsChallenge(d, {
      origin: ORIGIN,
      wallet: alice.wallet,
    });
    await expect(
      acceptTerms(d, {
        origin: ORIGIN,
        wallet: alice.wallet,
        nonce: challenge.nonce,
        signature: await mallory.sign(challenge.message),
        version: challenge.version,
        country: null,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", detail: "bad-signature" });
    // Mallory presents Alice's challenge as her own.
    const second = await issueTermsChallenge(d, {
      origin: ORIGIN,
      wallet: alice.wallet,
    });
    await expect(
      acceptTerms(d, {
        origin: ORIGIN,
        wallet: mallory.wallet,
        nonce: second.nonce,
        signature: await mallory.sign(second.message),
        version: second.version,
        country: null,
      }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      detail: "mismatch:wallet",
    });
    expect(store.rows).toHaveLength(0);
  });

  it("another site's challenge is refused (origin bound)", async () => {
    const { d } = deps();
    const signer = await makeSigner();
    const { input } = await signedAcceptance(d, signer);
    await expect(
      acceptTerms(d, { ...input, origin: "https://evil.example" }),
    ).rejects.toMatchObject({ detail: "mismatch:origin" });
  });

  it("old version: an acceptance names a version that is no longer current → refused", async () => {
    const { d } = deps();
    const signer = await makeSigner();
    const { input } = await signedAcceptance(d, signer);
    await expect(
      acceptTerms(d, { ...input, version: "2025-01-01-old" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      detail: "terms version mismatch",
    });
  });

  it("version bump: a stored acceptance of the old version or hash no longer passes the gate", async () => {
    const { d, store } = deps();
    const signer = await makeSigner();
    const { input } = await signedAcceptance(d, signer);
    await acceptTerms(d, input);
    // Simulate the bump: the stored row is for an older version/hash than the current one.
    store.rows[0]!.termsVersion = "2025-01-01-old";
    await expect(assertTermsAccepted(d, signer.wallet)).rejects.toMatchObject({
      code: "TERMS_REQUIRED",
    });
    store.rows[0]!.termsVersion = TERMS_VERSIONS.at(-1)!.version;
    store.rows[0]!.termsHash = "0".repeat(64);
    await expect(assertTermsAccepted(d, signer.wallet)).rejects.toMatchObject({
      code: "TERMS_REQUIRED",
    });
  });

  it("an expired challenge is refused", async () => {
    const { d } = deps();
    const signer = await makeSigner();
    const { input } = await signedAcceptance(d, signer);
    const late = { ...d, now: () => new Date(NOW.getTime() + 301_000) };
    await expect(acceptTerms(late, input)).rejects.toMatchObject({
      detail: "expired",
    });
  });

  it("the TERMS_REQUIRED message can be replaced (the Action points to the site)", async () => {
    const { d } = deps();
    await expect(
      assertTermsAccepted(
        d,
        "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz",
        "Open the site.",
      ),
    ).rejects.toMatchObject({ publicMessage: "Open the site." });
  });
});
