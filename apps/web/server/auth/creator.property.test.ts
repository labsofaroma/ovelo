import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { makeSigner, memoryStore } from "../test/creator-fixtures";
import {
  CHALLENGE_PURPOSES,
  CHALLENGE_TTL_SECONDS,
  type ChallengePurpose,
  issueChallenge,
  verifyChallenge,
} from "./creator";

/**
 * Property tests for the creator challenge (REWRITE-PLAN §8). `fast-check` is not installed and
 * M5a may not add dependencies (docs/M5-NEEDS-FROM-M4.md #1), so the properties run on a seeded
 * PRNG: every case is reproducible from its seed, printed on failure.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RUNS = 200;
const ORIGIN = "https://aroma.test";
const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const MINTS = [
  "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
];

type Random = () => number;
const int = (rand: Random, min: number, max: number) =>
  min + Math.floor(rand() * (max - min + 1));
const pick = <T>(rand: Random, items: readonly T[]): T =>
  items[int(rand, 0, items.length - 1)]!;

function randomContent(rand: Random) {
  const first = int(rand, 1, 9_999);
  return {
    name: `Basket ${int(rand, 0, 1e6)}`,
    ticker: `T${int(rand, 10, 99_999)}`,
    allocations: [
      { mint: MINTS[0]!, weightBps: first },
      { mint: MINTS[1]!, weightBps: 10_000 - first },
    ],
  };
}

const uuid = (rand: Random) =>
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
    int(rand, 0, 15).toString(16),
  );

async function setup(rand: Random) {
  const store = memoryStore();
  const signer = await makeSigner();
  const purpose = pick(rand, CHALLENGE_PURPOSES);
  const content = purpose === "delete" ? null : randomContent(rand);
  const base = {
    origin: ORIGIN,
    wallet: signer.wallet,
    purpose,
    basketId: purpose === "redeem" ? null : uuid(rand),
    content,
    summary: content ? [`Basket: ${content.name}`] : [],
  };
  const issuedAt = NOW + int(rand, 0, 10_000_000);
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

async function forEachSeed(
  property: (rand: Random, seed: number) => Promise<void>,
) {
  for (let seed = 1; seed <= RUNS; seed += 1) {
    try {
      await property(mulberry32(seed), seed);
    } catch (error) {
      throw new Error(`property failed for seed ${seed}`, { cause: error });
    }
  }
}

describe("creator challenge properties", () => {
  it("an untouched request inside the window verifies exactly once", async () => {
    await forEachSeed(async (rand) => {
      const { store, request, issuedAt } = await setup(rand);
      const at = issuedAt + int(rand, 0, CHALLENGE_TTL_SECONDS * 1000 - 1);
      await expect(
        verifyChallenge(store, request, { now: at }),
      ).resolves.toMatchObject({ wallet: request.wallet });
      expect(
        await refusal(() => verifyChallenge(store, request, { now: at })),
      ).toBe("unknown-or-used-nonce");
    });
  }, 60_000);

  it("tampering with any signature byte is refused", async () => {
    await forEachSeed(async (rand) => {
      const { store, request, issuedAt } = await setup(rand);
      const bytes = Buffer.from(request.signature, "base64");
      const index = int(rand, 0, 63);
      bytes[index] = bytes[index]! ^ int(rand, 1, 255);
      const detail = await refusal(() =>
        verifyChallenge(
          store,
          { ...request, signature: bytes.toString("base64") },
          { now: issuedAt },
        ),
      );
      expect(detail).toBe("bad-signature");
    });
  }, 60_000);

  it("tampering with the content (any weight or name) is refused", async () => {
    await forEachSeed(async (rand) => {
      const { store, request, issuedAt } = await setup(rand);
      const content =
        request.content === null
          ? { name: "added" }
          : rand() < 0.5
            ? {
                ...request.content,
                allocations: [
                  {
                    ...request.content.allocations[0]!,
                    weightBps:
                      request.content.allocations[0]!.weightBps +
                      int(rand, 1, 50),
                  },
                  request.content.allocations[1]!,
                ],
              }
            : { ...request.content, name: `${request.content.name}!` };
      expect(
        await refusal(() =>
          verifyChallenge(store, { ...request, content }, { now: issuedAt }),
        ),
      ).toBe("mismatch:content");
    });
  }, 60_000);

  it("any time at or after expiry is refused", async () => {
    await forEachSeed(async (rand) => {
      const { store, request, issuedAt } = await setup(rand);
      const late =
        issuedAt + CHALLENGE_TTL_SECONDS * 1000 + int(rand, 0, 86_400_000);
      expect(
        await refusal(() => verifyChallenge(store, request, { now: late })),
      ).toBe("expired");
    });
  }, 60_000);

  it("a replay after success is refused at any later time", async () => {
    await forEachSeed(async (rand) => {
      const { store, request, issuedAt } = await setup(rand);
      await verifyChallenge(store, request, { now: issuedAt });
      const later = issuedAt + int(rand, 0, 10 * CHALLENGE_TTL_SECONDS * 1000);
      expect(
        await refusal(() => verifyChallenge(store, request, { now: later })),
      ).toBe("unknown-or-used-nonce");
    });
  }, 60_000);

  it("another wallet's signature, or a claim to be another wallet, is refused", async () => {
    await forEachSeed(async (rand) => {
      const { store, request, issuedAt } = await setup(rand);
      const other = await makeSigner();
      if (rand() < 0.5) {
        // The attacker signs the same message with their own key.
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
    });
  }, 60_000);

  it("a challenge issued for one purpose never authorizes another", async () => {
    await forEachSeed(async (rand) => {
      const { store, request, issuedAt } = await setup(rand);
      const others = CHALLENGE_PURPOSES.filter((p) => p !== request.purpose);
      const purpose: ChallengePurpose = pick(rand, others);
      expect(
        await refusal(() =>
          verifyChallenge(store, { ...request, purpose }, { now: issuedAt }),
        ),
      ).toBe("mismatch:purpose");
    });
  }, 60_000);
});
