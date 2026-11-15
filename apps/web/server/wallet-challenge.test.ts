import { describe, expect, it } from "vitest";
import { makeSigner, memoryStore } from "./test/creator-fixtures";
import {
  issueWalletChallenge,
  verifyWalletChallenge,
  type WalletChallengeInput,
} from "./wallet-challenge";

const ORIGIN = "https://ovelo.example";
const NOW = Date.parse("2026-11-15T12:00:00Z");

async function setup(over: Partial<WalletChallengeInput> = {}) {
  const signer = await makeSigner();
  const store = memoryStore();
  const input: WalletChallengeInput = {
    origin: ORIGIN,
    wallet: signer.wallet,
    purpose: "notify-subscribe",
    content: { channel: "telegram", events: ["trade_confirmed"] },
    summary: ["Channel: Telegram"],
    ...over,
  };
  const issued = await issueWalletChallenge(store, input, NOW);
  const signature = await signer.sign(issued.message);
  return { signer, store, input, issued, signature };
}

describe("M11 wallet challenges", () => {
  it("the message names the site, the purpose and says no funds move", async () => {
    const { issued } = await setup();
    expect(issued.message).toContain(
      "ovelo.example asks you to turn on an Ovelo notification channel.",
    );
    expect(issued.message).toContain("does not move funds");
  });

  it("verifies once; a replay of the same signature is refused", async () => {
    const { store, input, issued, signature } = await setup();
    const request = { ...input, nonce: issued.nonce, signature };
    await expect(
      verifyWalletChallenge(store, request, NOW + 1_000),
    ).resolves.toBeUndefined();
    await expect(
      verifyWalletChallenge(store, request, NOW + 2_000),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      detail: "unknown-or-used-nonce",
    });
  });

  it.each([
    ["origin", { origin: "https://evil.example" }, "mismatch:origin"],
    ["purpose", { purpose: "creator-dashboard" as const }, "mismatch:purpose"],
    [
      "content",
      { content: { channel: "push", events: ["trade_confirmed"] } },
      "mismatch:content",
    ],
  ])(
    "a different %s is refused (and burns the nonce)",
    async (_name, change, detail) => {
      const { store, input, issued, signature } = await setup();
      await expect(
        verifyWalletChallenge(
          store,
          { ...input, ...change, nonce: issued.nonce, signature },
          NOW,
        ),
      ).rejects.toMatchObject({ detail });
      expect(store.data.size).toBe(0);
    },
  );

  it("another wallet's signature, and an expired challenge, are refused", async () => {
    const { store, input, issued } = await setup();
    const other = await makeSigner();
    await expect(
      verifyWalletChallenge(
        store,
        {
          ...input,
          nonce: issued.nonce,
          signature: await other.sign(issued.message),
        },
        NOW,
      ),
    ).rejects.toMatchObject({ detail: "bad-signature" });
    const late = await setup();
    await expect(
      verifyWalletChallenge(
        late.store,
        { ...late.input, nonce: late.issued.nonce, signature: late.signature },
        NOW + 301_000,
      ),
    ).rejects.toMatchObject({ detail: "expired" });
  });
});
