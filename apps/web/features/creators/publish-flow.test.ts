import { afterEach, describe, expect, it, vi } from "vitest";
import { CreatorApiError, creatorApi, JSON_HEADERS } from "./api";
import {
  archiveBasketFlow,
  type FlowDeps,
  flowErrorMessage,
  type FlowStep,
  publishBasketFlow,
  toBase64,
  UNSUPPORTED_WALLET,
} from "./publish-flow";

/** M5b B2: connect → (first time) redeem → challenge → sign → submit, with explicit steps. */
const WALLET = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const BASKET_ID = "8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20";
const basket = {
  name: "Chips",
  ticker: "CHIPS",
  description: "",
  allocations: [
    { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", weightBps: 5000 },
    { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", weightBps: 5000 },
  ],
};
const published = {
  id: BASKET_ID,
  creatorWallet: WALLET,
  name: "Chips",
  ticker: "CHIPS",
  status: "published" as const,
  version: 1,
  publishedAt: "2026-11-14T10:00:00.000Z",
  allocations: [],
};

function harness(overrides: Partial<FlowDeps> = {}) {
  const steps: FlowStep[] = [];
  const signed: string[] = [];
  const api = {
    challenge: vi.fn(async (body: { purpose: string }) => ({
      nonce: `nonce-${body.purpose}`,
      message: `Ovelo: sign to ${body.purpose} ✓`,
      basketId: body.purpose === "redeem" ? null : BASKET_ID,
      expiresAt: "2026-11-14T10:05:00.000Z",
    })),
    redeem: vi.fn(async () => ({
      creator: { wallet: WALLET, displayName: "Ada" },
    })),
    publish: vi.fn(async () => ({ basket: published })),
    archive: vi.fn(async () => ({
      basket: { ...published, status: "archived" as const },
    })),
  };
  const deps: FlowDeps = {
    api,
    wallet: WALLET,
    signMessage: async (bytes) => {
      signed.push(new TextDecoder().decode(bytes));
      return new Uint8Array(64).fill(9);
    },
    onStep: (step) => steps.push(step),
    ...overrides,
  };
  return { deps, api, steps, signed };
}

const SIG = toBase64(new Uint8Array(64).fill(9));

describe("publishBasketFlow", () => {
  it("a creator signs the exact challenge text (UTF-8) and publishes", async () => {
    const h = harness();
    expect(await publishBasketFlow(h.deps, { basket })).toEqual(published);
    expect(h.signed).toEqual(["Ovelo: sign to publish ✓"]);
    expect(h.api.publish).toHaveBeenCalledWith({
      wallet: WALLET,
      nonce: "nonce-publish",
      signature: SIG,
      basketId: BASKET_ID,
      basket,
    });
    expect(h.api.redeem).not.toHaveBeenCalled();
    expect(h.steps.map((s) => s.step)).toEqual([
      "challenge",
      "signing",
      "submitting",
      "done",
    ]);
  });

  it("a new creator redeems the invite first (two signatures), then publishes", async () => {
    const h = harness();
    const invite = { code: "abc-def", profile: { displayName: "Ada" } };
    await publishBasketFlow(h.deps, { basket, invite });
    expect(h.signed).toEqual([
      "Ovelo: sign to redeem ✓",
      "Ovelo: sign to publish ✓",
    ]);
    expect(h.api.redeem).toHaveBeenCalledWith({
      wallet: WALLET,
      nonce: "nonce-redeem",
      signature: SIG,
      code: "abc-def",
      profile: { displayName: "Ada" },
    });
    expect(h.api.redeem.mock.invocationCallOrder[0]!).toBeLessThan(
      h.api.publish.mock.invocationCallOrder[0]!,
    );
  });

  it("a new version names the basket in the challenge", async () => {
    const h = harness();
    await publishBasketFlow(h.deps, { basket, basketId: BASKET_ID });
    expect(h.api.challenge).toHaveBeenCalledWith({
      purpose: "publish",
      wallet: WALLET,
      basket,
      basketId: BASKET_ID,
    });
  });

  it("a refused invite stops before publishing (nothing is published)", async () => {
    const h = harness();
    h.api.redeem.mockRejectedValueOnce(
      new CreatorApiError("FORBIDDEN", "This invite cannot be used.", 403),
    );
    const run = publishBasketFlow(h.deps, {
      basket,
      invite: { code: "used", profile: { displayName: "Ada" } },
    });
    await expect(run).rejects.toThrow("This invite cannot be used.");
    expect(h.api.publish).not.toHaveBeenCalled();
  });

  it("a wallet that cannot sign messages is refused before any request", async () => {
    const h = harness({ signMessage: null });
    await expect(publishBasketFlow(h.deps, { basket })).rejects.toThrow(
      UNSUPPORTED_WALLET,
    );
    expect(h.api.challenge).not.toHaveBeenCalled();
  });
});

describe("archiveBasketFlow", () => {
  it("signs a delete challenge and archives", async () => {
    const h = harness();
    const result = await archiveBasketFlow(h.deps, BASKET_ID);
    expect(result.status).toBe("archived");
    expect(h.api.archive).toHaveBeenCalledWith(BASKET_ID, {
      wallet: WALLET,
      nonce: "nonce-delete",
      signature: SIG,
    });
  });
});

describe("flowErrorMessage (user-safe)", () => {
  it("passes the server's public message, explains a declined signature, hides wallet internals", () => {
    expect(
      flowErrorMessage(
        new CreatorApiError("UNAUTHORIZED", "Signature expired."),
      ),
    ).toBe("Signature expired.");
    expect(flowErrorMessage(new Error("User rejected the request."))).toMatch(
      /declined in your wallet/,
    );
    expect(flowErrorMessage(new Error("0x1f stack at foo.js:12"))).toBe(
      "The wallet could not sign the request. Nothing was published.",
    );
    expect(flowErrorMessage(new Error(UNSUPPORTED_WALLET))).toBe(
      UNSUPPORTED_WALLET,
    );
  });
});

describe("creatorApi (A4: every mutation is JSON with Content-Type)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(status = 200, body: unknown = {}) {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  const challenge = {
    nonce: "n",
    message: "m",
    basketId: BASKET_ID,
    expiresAt: "2026-11-14T10:05:00.000Z",
  };

  it.each([
    [
      "challenge",
      () =>
        creatorApi.challenge({
          purpose: "delete",
          wallet: WALLET,
          basketId: BASKET_ID,
        }),
      "/api/v1/creators/challenge",
      "POST",
      challenge,
    ],
    [
      "redeem",
      () =>
        creatorApi.redeem({
          wallet: WALLET,
          nonce: "n",
          signature: SIG,
          code: "c",
          profile: { displayName: "A" },
        }),
      "/api/v1/creators/invites/redeem",
      "POST",
      { creator: { wallet: WALLET, displayName: "A" } },
    ],
    [
      "publish",
      () =>
        creatorApi.publish({
          wallet: WALLET,
          nonce: "n",
          signature: SIG,
          basketId: BASKET_ID,
          basket,
        }),
      "/api/v1/creators/baskets",
      "POST",
      { basket: published },
    ],
    [
      "archive",
      () =>
        creatorApi.archive(BASKET_ID, {
          wallet: WALLET,
          nonce: "n",
          signature: SIG,
        }),
      `/api/v1/creators/baskets/${BASKET_ID}`,
      "DELETE",
      { basket: published },
    ],
  ] as const)(
    "%s sends JSON with the header",
    async (_name, run, url, method, body) => {
      const fetch = stubFetch(200, body);
      await run();
      const [calledUrl, init] = fetch.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(calledUrl).toBe(url);
      expect(init.method).toBe(method);
      expect(init.headers).toEqual(JSON_HEADERS);
      expect(() => JSON.parse(String(init.body))).not.toThrow();
    },
  );

  it("publish sends action: publish", async () => {
    const fetch = stubFetch(200, { basket: published });
    await creatorApi.publish({
      wallet: WALLET,
      nonce: "n",
      signature: SIG,
      basketId: BASKET_ID,
      basket,
    });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({ action: "publish" });
  });

  it("maps errors to { code, message } and nothing else", async () => {
    stubFetch(429, { code: "RATE_LIMITED", message: "Too many requests." });
    await expect(
      creatorApi.challenge({
        purpose: "delete",
        wallet: WALLET,
        basketId: BASKET_ID,
      }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Too many requests.",
      status: 429,
    });
    stubFetch(500, { stack: "secret" });
    await expect(
      creatorApi.challenge({
        purpose: "delete",
        wallet: WALLET,
        basketId: BASKET_ID,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL",
      message: "Something went wrong.",
    });
  });

  it("isCreator: 200 yes, 404 no, other errors propagate", async () => {
    stubFetch(200, { wallet: WALLET, displayName: "Ada" });
    expect(await creatorApi.isCreator(WALLET)).toBe(true);
    stubFetch(404, {
      code: "NOT_FOUND",
      message: "No creator uses this wallet.",
    });
    expect(await creatorApi.isCreator(WALLET)).toBe(false);
    stubFetch(503, { code: "SERVICE_UNAVAILABLE", message: "Down." });
    await expect(creatorApi.isCreator(WALLET)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
