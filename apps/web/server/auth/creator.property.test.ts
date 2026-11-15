import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { makeSigner, memoryStore } from "../test/creator-fixtures";
import {
  CHALLENGE_PURPOSES,
  CHALLENGE_TTL_SECONDS,
  issueChallenge,
  verifyChallenge,
} from "./creator";

/**
 * Property tests for the creator challenge (REWRITE-PLAN §8), on fast-check (M5-NEEDS-FROM-M4
 * #1: M5a ran the same properties on a seeded PRNG while it could not add dependencies). A
 * failure prints the counterexample and the seed that replays it.
 */

const RUNS = 200;
const TTL_MS = CHALLENGE_TTL_SECONDS * 1000;
const ORIGIN = "https://ovelo.test";
const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const MINTS = [
  "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
] as const;

/** One challenge's inputs: any purpose, a two-leg basket summing to 10,000 bps, any issue time. */
const challengeCase = fc.record({
  purpose: fc.constantFrom(...CHALLENGE_PURPOSES),
  firstBps: fc.integer({ min: 1, max: 9_999 }),
  nameId: fc.nat({ max: 1_000_000 }),
  tickerId: fc.integer({ min: 10, max: 99_999 }),
  basketId: fc.uuid({ version: 4 }),
  issuedOffset: fc.nat({ max: 10_000_000 }),
});
type Case = typeof challengeCase extends fc.Arbitrary<infer T> ? T : never;

async function setup(input: Case) {
  const store = memoryStore();
  const signer = await makeSigner();
  const content =
    input.purpose === "delete"
      ? null
      : {
          name: `Basket ${input.nameId}`,
          ticker: `T${input.tickerId}`,
          allocations: [
            { mint: MINTS[0], weightBps: input.firstBps },
            { mint: MINTS[1], weightBps: 10_000 - input.firstBps },
          ],
        };
  const base = {
    origin: ORIGIN,
    wallet: signer.wallet,
    purpose: input.purpose,
    basketId: input.purpose === "redeem" ? null : input.basketId,
    content,
    summary: content ? [`Basket: ${content.name}`] : [],
  };
  const issuedAt = NOW + input.issuedOffset;
  const challenge = await issueChallenge(store, base, { now: issuedAt });
  const request = {
    ...base,
    nonce: challenge.payload.nonce,
    signature: await signer.sign(challenge.message),
  };
  return { store, request, issuedAt };
}

async function refusal(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHORIZED")
      return error.detail ?? "";
    throw error;
  }
}

const check = <T>(arb: fc.Arbitrary<T>, run: (value: T) => Promise<void>) =>
  fc.assert(fc.asyncProperty(arb, run), { numRuns: RUNS });

describe("creator challenge properties (fast-check)", () => {
  it("an untouched request inside the window verifies exactly once", async () => {
    await check(
      fc.tuple(challengeCase, fc.nat({ max: TTL_MS - 1 })),
      async ([input, delay]) => {
        const { store, request, issuedAt } = await setup(input);
        const at = issuedAt + delay;
        await expect(
          verifyChallenge(store, request, { now: at }),
        ).resolves.toMatchObject({ wallet: request.wallet });
        expect(
          await refusal(() => verifyChallenge(store, request, { now: at })),
        ).toBe("unknown-or-used-nonce");
      },
    );
  }, 60_000);

  it("tampering with any signature byte is refused", async () => {
    await check(
      fc.tuple(
        challengeCase,
        fc.nat({ max: 63 }),
        fc.integer({ min: 1, max: 255 }),
      ),
      async ([input, index, flip]) => {
        const { store, request, issuedAt } = await setup(input);
        const bytes = Buffer.from(request.signature, "base64");
        bytes[index] = bytes[index]! ^ flip;
        expect(
          await refusal(() =>
            verifyChallenge(
              store,
              { ...request, signature: bytes.toString("base64") },
              { now: issuedAt },
            ),
          ),
        ).toBe("bad-signature");
      },
    );
  }, 60_000);

  it("tampering with the content (any weight or name) is refused", async () => {
    await check(
      fc.tuple(challengeCase, fc.boolean(), fc.integer({ min: 1, max: 50 })),
      async ([input, weight, delta]) => {
        const { store, request, issuedAt } = await setup(input);
        const original = request.content;
        const content =
          original === null
            ? { name: "added" }
            : weight
              ? {
                  ...original,
                  allocations: [
                    {
                      ...original.allocations[0]!,
                      weightBps: original.allocations[0]!.weightBps + delta,
                    },
                    original.allocations[1]!,
                  ],
                }
              : { ...original, name: `${original.name}!` };
        expect(
          await refusal(() =>
            verifyChallenge(store, { ...request, content }, { now: issuedAt }),
          ),
        ).toBe("mismatch:content");
      },
    );
  }, 60_000);

  it("any time at or after expiry is refused", async () => {
    await check(
      fc.tuple(challengeCase, fc.nat({ max: 86_400_000 })),
      async ([input, extra]) => {
        const { store, request, issuedAt } = await setup(input);
        expect(
          await refusal(() =>
            verifyChallenge(store, request, { now: issuedAt + TTL_MS + extra }),
          ),
        ).toBe("expired");
      },
    );
  }, 60_000);

  it("a replay after success is refused at any later time", async () => {
    await check(
      fc.tuple(challengeCase, fc.nat({ max: 10 * TTL_MS })),
      async ([input, later]) => {
        const { store, request, issuedAt } = await setup(input);
        await verifyChallenge(store, request, { now: issuedAt });
        expect(
          await refusal(() =>
            verifyChallenge(store, request, { now: issuedAt + later }),
          ),
        ).toBe("unknown-or-used-nonce");
      },
    );
  }, 60_000);

  it("another wallet's signature, or a claim to be another wallet, is refused", async () => {
    await check(
      fc.tuple(challengeCase, fc.boolean()),
      async ([input, forge]) => {
        const { store, request, issuedAt } = await setup(input);
        const other = await makeSigner();
        if (forge) {
          // The attacker signs with their own key.
          const forged = await other.sign("anything");
          expect(
            await refusal(() =>
              verifyChallenge(
                store,
                { ...request, signature: forged },
                { now: issuedAt },
              ),
            ),
          ).toBe("bad-signature");
        } else {
          expect(
            await refusal(() =>
              verifyChallenge(
                store,
                { ...request, wallet: other.wallet },
                { now: issuedAt },
              ),
            ),
          ).toBe("mismatch:wallet");
        }
      },
    );
  }, 60_000);

  it("a challenge issued for one purpose never authorizes another", async () => {
    await check(
      fc
        .tuple(challengeCase, fc.constantFrom(...CHALLENGE_PURPOSES))
        .filter(([input, purpose]) => input.purpose !== purpose),
      async ([input, purpose]) => {
        const { store, request, issuedAt } = await setup(input);
        expect(
          await refusal(() =>
            verifyChallenge(store, { ...request, purpose }, { now: issuedAt }),
          ),
        ).toBe("mismatch:purpose");
      },
    );
  }, 60_000);
});
