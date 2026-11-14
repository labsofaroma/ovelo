import { randomBytes } from "node:crypto";
import { stubBaseEnv } from "@/server/test/base-env";
import { getAddressDecoder } from "@solana/kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as baskets } from "@/app/api/v1/creators/baskets/route";
import { POST as challenge } from "@/app/api/v1/creators/challenge/route";
import { DESCRIPTION_MAX, MAX_LEGS, NAME_MAX } from "../schema";
import {
  apiHarness,
  enrol,
  json,
  jsonRequest,
  makeSigner,
  type Signer,
  signedFields,
} from "../test/api";

/**
 * M5b A4: the handlers' own body caps (parse(schema, { maxBytes })) never refuse a legitimate
 * basket. The largest valid publish goes through; a 20-allocation body is refused by the schema
 * (400), not by a size limit (413). Middleware's caps are in server/middleware.creators.test.ts.
 */
let h: Awaited<ReturnType<typeof apiHarness>>;
let creator: Signer;
const mints = Array.from({ length: 20 }, () =>
  getAddressDecoder().decode(randomBytes(32)),
);

beforeAll(async () => {
  h = await apiHarness();
  creator = await makeSigner();
  await enrol(h.db, h.client, creator);
});
afterAll(async () => {
  await h.client.close();
});
beforeEach(() => {
  stubBaseEnv();
  h.state.registry = new Map(
    mints.map((mint, i) => [mint, { symbol: `S${i}x` }]),
  );
});

function basket(legs: number) {
  const base = Math.floor(10_000 / legs);
  return {
    // Non-ASCII text is the largest per character on the wire.
    name: "€".repeat(NAME_MAX),
    ticker: "MAXIMAL",
    description: "€".repeat(DESCRIPTION_MAX),
    allocations: mints.slice(0, legs).map((mint, i) => ({
      mint,
      weightBps: base + (i < 10_000 - base * legs ? 1 : 0),
    })),
  };
}

describe("creator payload sizes", () => {
  it(`publishes the largest valid basket (${MAX_LEGS} legs, full-length text)`, async () => {
    const content = basket(MAX_LEGS);
    const fields = await signedFields(challenge, creator, {
      purpose: "publish",
      basket: content,
    });
    const request = jsonRequest("/api/v1/creators/baskets", "POST", {
      action: "publish",
      wallet: creator.wallet,
      basketId: fields.basketId,
      basket: content,
      nonce: fields.nonce,
      signature: fields.signature,
    });
    const response = await baskets(request);
    expect(response.status).toBe(201);
    const body = (await json(response)) as {
      basket: { allocations: unknown[] };
    };
    expect(body.basket.allocations).toHaveLength(MAX_LEGS);
  });

  it("a 20-allocation basket is a schema refusal (400), not a size refusal (413)", async () => {
    for (const route of [
      () =>
        challenge(
          jsonRequest("/api/v1/creators/challenge", "POST", {
            purpose: "publish",
            wallet: creator.wallet,
            basket: basket(20),
          }),
        ),
      () =>
        baskets(
          jsonRequest("/api/v1/creators/baskets", "POST", {
            action: "publish",
            wallet: creator.wallet,
            basketId: crypto.randomUUID(),
            basket: basket(20),
            nonce: "n".repeat(32),
            signature: "s".repeat(88),
          }),
        ),
    ]) {
      const response = await route();
      expect(response.status).toBe(400);
      expect((await json(response)).code).toBe("VALIDATION_FAILED");
    }
  });
});
