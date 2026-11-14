import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toMarketsView } from "@/features/markets/normalize";
import { snapshot } from "@/features/test/fixtures";
import { resetEnvCacheForTests } from "@/server/env";
import { makeSigner, memoryStore } from "@/server/test/creator-fixtures";
import { setComplianceDepsForTests } from "./server/deps";
import { memoryTermsStore } from "./server/store";
import { loadPolicy } from "./policy";

/**
 * M9 compliance gate, route level (the real gate and terms code; in-memory stores): the quote,
 * submit and Action routes refuse a blocked location and a wallet without the current terms,
 * the status route reports both, and challenge → sign → accept works once per signature.
 */
const service = vi.hoisted(() => ({
  quoteTrade: vi.fn(),
  submitSignedTrade: vi.fn(),
  tradeStatus: vi.fn(),
  publicRecord: (r: unknown) => r,
}));
vi.mock("@/features/trade/server/service", () => service);
vi.mock("@/features/markets/server", () => ({
  getMarkets: async () => ({ state: "ok", data: toMarketsView(snapshot()) }),
}));

const quote = await import("@/app/api/v1/trade/quote/route");
const submit = await import("@/app/api/v1/trade/submit/route");
const action = await import("@/app/api/v1/actions/baskets/[id]/route");
const status = await import("@/app/api/v1/compliance/status/route");
const challenge = await import("@/app/api/v1/compliance/terms/challenge/route");
const accept = await import("@/app/api/v1/compliance/terms/accept/route");

const SITE = "https://aroma.example";
const json = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`${SITE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const DE = { "x-vercel-ip-country": "DE" };
const US = { "x-vercel-ip-country": "US" };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const quoteBody = (taker: string) => ({
  target: { kind: "spot", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: "10",
  taker,
  supportedTransactionVersions: [0],
});

let terms: ReturnType<typeof memoryTermsStore>;
beforeEach(() => {
  vi.stubEnv("AROMA_V1_ENABLED", "true");
  vi.stubEnv("AROMA_SITE_URL", SITE);
  vi.stubEnv("AROMA_TRUST_PROXY", "true");
  resetEnvCacheForTests();
  terms = memoryTermsStore();
  const challenges = memoryStore();
  setComplianceDepsForTests({
    store: () => terms,
    challenges: () => challenges,
    policy: () => loadPolicy(process.env),
  });
  service.quoteTrade.mockReset();
  service.quoteTrade.mockResolvedValue({
    requestId: "r",
    transactions: ["AA"],
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
  setComplianceDepsForTests({});
});

async function acceptFor(signer: Awaited<ReturnType<typeof makeSigner>>) {
  const issued = await challenge.POST(
    json("/api/v1/compliance/terms/challenge", { wallet: signer.wallet }, DE),
  );
  expect(issued.status).toBe(200);
  const body = (await issued.json()) as {
    nonce: string;
    message: string;
    version: string;
  };
  const signed = {
    wallet: signer.wallet,
    nonce: body.nonce,
    signature: await signer.sign(body.message),
    version: body.version,
  };
  return {
    signed,
    response: await accept.POST(
      json("/api/v1/compliance/terms/accept", signed, DE),
    ),
  };
}

describe("POST /api/v1/trade/quote", () => {
  it("blocked country → 451 JURISDICTION_RESTRICTED, nothing quoted", async () => {
    const signer = await makeSigner();
    const response = await quote.POST(
      json("/api/v1/trade/quote", quoteBody(signer.wallet), US),
    );
    expect(response.status).toBe(451);
    expect(await response.json()).toEqual({
      code: "JURISDICTION_RESTRICTED",
      message: expect.stringMatching(/not available in your location/),
    });
    expect(service.quoteTrade).not.toHaveBeenCalled();
  });

  it("missing header and untrusted proxy fail closed", async () => {
    const signer = await makeSigner();
    expect(
      (await quote.POST(json("/api/v1/trade/quote", quoteBody(signer.wallet))))
        .status,
    ).toBe(451);
    vi.stubEnv("AROMA_TRUST_PROXY", "false");
    expect(
      (
        await quote.POST(
          json("/api/v1/trade/quote", quoteBody(signer.wallet), DE),
        )
      ).status,
    ).toBe(451);
    expect(service.quoteTrade).not.toHaveBeenCalled();
  });

  it("allowed country without the current terms → 403 TERMS_REQUIRED; after accepting → quoted", async () => {
    const signer = await makeSigner();
    const first = await quote.POST(
      json("/api/v1/trade/quote", quoteBody(signer.wallet), DE),
    );
    expect(first.status).toBe(403);
    expect((await first.json()).code).toBe("TERMS_REQUIRED");
    expect(service.quoteTrade).not.toHaveBeenCalled();
    const { response } = await acceptFor(signer);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true });
    const second = await quote.POST(
      json("/api/v1/trade/quote", quoteBody(signer.wallet), DE),
    );
    expect(second.status).toBe(200);
    expect(service.quoteTrade).toHaveBeenCalledOnce();
  });

  it("another wallet's acceptance does not count", async () => {
    const alice = await makeSigner();
    const bob = await makeSigner();
    await acceptFor(alice);
    const response = await quote.POST(
      json("/api/v1/trade/quote", quoteBody(bob.wallet), DE),
    );
    expect((await response.json()).code).toBe("TERMS_REQUIRED");
  });
});

describe("terms routes", () => {
  it("a replayed acceptance is refused (401) and stores nothing new", async () => {
    const signer = await makeSigner();
    const { signed } = await acceptFor(signer);
    const replay = await accept.POST(
      json("/api/v1/compliance/terms/accept", signed, DE),
    );
    expect(replay.status).toBe(401);
    expect(terms.rows).toHaveLength(1);
    expect(terms.rows[0]!.country).toBe("DE");
  });

  it("an old version is refused (409)", async () => {
    const signer = await makeSigner();
    const issued = await challenge.POST(
      json("/api/v1/compliance/terms/challenge", { wallet: signer.wallet }),
    );
    const body = (await issued.json()) as { nonce: string; message: string };
    const response = await accept.POST(
      json("/api/v1/compliance/terms/accept", {
        wallet: signer.wallet,
        nonce: body.nonce,
        signature: await signer.sign(body.message),
        version: "2025-01-01-old",
      }),
    );
    expect(response.status).toBe(409);
    expect(terms.rows).toHaveLength(0);
  });

  it("status reports location, trade, browse and the wallet's terms state", async () => {
    const signer = await makeSigner();
    const read = async (headers: Record<string, string>, wallet?: string) =>
      (
        await status.GET(
          new Request(
            `${SITE}/api/v1/compliance/status${wallet ? `?wallet=${wallet}` : ""}`,
            { headers },
          ),
        )
      ).json();
    expect(await read(US)).toMatchObject({
      jurisdiction: "restricted",
      trade: false,
      browse: true,
      terms: { accepted: null, final: false },
    });
    expect(await read({})).toMatchObject({
      jurisdiction: "unknown",
      trade: false,
    });
    expect(await read(DE, signer.wallet)).toMatchObject({
      jurisdiction: "allowed",
      trade: true,
      terms: { accepted: false },
    });
    await acceptFor(signer);
    expect(await read(DE, signer.wallet)).toMatchObject({
      terms: { accepted: true },
    });
  });
});

describe("POST /api/v1/trade/submit", () => {
  it("re-checks the location", async () => {
    const response = await submit.POST(
      json(
        "/api/v1/trade/submit",
        { authorization: "a", signedTransactions: ["AAAA"] },
        US,
      ),
    );
    expect(response.status).toBe(451);
    expect(service.submitSignedTrade).not.toHaveBeenCalled();
  });
});

describe("Solana Action", () => {
  const post = (headers: Record<string, string>, account: string) =>
    action.POST(
      json(
        "/api/v1/actions/baskets/test-basket?amount=2",
        { account },
        headers,
      ),
      params("test-basket"),
    );

  it("POST from a blocked country → 451 with a readable message and Action headers", async () => {
    const signer = await makeSigner();
    const response = await post(US, signer.wallet);
    expect(response.status).toBe(451);
    expect((await response.json()).code).toBe("JURISDICTION_RESTRICTED");
    expect(response.headers.get("x-action-version")).toBe("2.4");
    expect(service.quoteTrade).not.toHaveBeenCalled();
  });

  it("POST without the terms points the account to the site; after accepting it quotes", async () => {
    const signer = await makeSigner();
    const refused = await post(DE, signer.wallet);
    expect(refused.status).toBe(403);
    const body = await refused.json();
    expect(body.code).toBe("TERMS_REQUIRED");
    expect(body.message).toContain(`${SITE}/v1/basket/test-basket`);
    await acceptFor(signer);
    await post(DE, signer.wallet);
    expect(service.quoteTrade).toHaveBeenCalledOnce();
  });

  it("GET shows the Action disabled with the reason for a blocked country, and carries the disclosure", async () => {
    const blocked = await (
      await action.GET(
        new Request(`${SITE}/api/v1/actions/baskets/test-basket`, {
          headers: US,
        }),
        params("test-basket"),
      )
    ).json();
    expect(blocked.disabled).toBe(true);
    expect(blocked.error.message).toMatch(/not available in your location/);
    const open = await (
      await action.GET(
        new Request(`${SITE}/api/v1/actions/baskets/test-basket`, {
          headers: DE,
        }),
        params("test-basket"),
      )
    ).json();
    expect(open.disabled).toBeUndefined();
    expect(open.description).toMatch(
      /Risk disclosure \(placeholder, pending counsel's text\)/,
    );
    expect(open.description).toMatch(/you can lose the full amount/);
  });
});
