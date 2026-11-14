import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as TradeAuth from "@/server/auth/trade";

/** Route-handler contract (REWRITE-PLAN §8): gate, origin, parse, mapError → `{ code, message }`. */
const service = vi.hoisted(() => ({
  quoteTrade: vi.fn(),
  submitSignedTrade: vi.fn(),
  tradeStatus: vi.fn(),
  publicRecord: (r: unknown) => r,
}));
// M9: the compliance gate has its own route tests (features/compliance/routes.test.ts).
vi.mock("@/features/compliance/server/gate", () => ({
  assertTradeCompliance: vi.fn(async () => {}),
  assertJurisdiction: vi.fn(),
  requestJurisdiction: vi.fn(() => ({ status: "allowed", country: "DE" })),
}));
vi.mock("@/features/compliance/server/deps", () => ({
  complianceDeps: () => ({ policy: () => ({}) }),
}));
// Phase A: the beta gate has its own route tests (features/beta/routes.test.ts).
vi.mock("@/features/beta/server/gate", () => ({
  assertTradeAccess: vi.fn(async () => {}),
  assertBetaAccess: vi.fn(async () => {}),
}));
vi.mock("@/server/auth/trade", async (importOriginal) => ({
  ...(await importOriginal<typeof TradeAuth>()),
  keyringFromEnv: () => ({
    current: { kid: "k", secret: "s" },
    previous: null,
  }),
  openAuthorization: () => ({
    taker: "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz",
  }),
}));
vi.mock("@/features/trade/server/service", () => service);
vi.mock("@/features/portfolio/service", () => ({ loadPortfolio: vi.fn() }));

const quote = await import("@/app/api/v1/trade/quote/route");
const submit = await import("@/app/api/v1/trade/submit/route");
const status = await import("@/app/api/v1/trade/[id]/route");
const portfolio = await import("@/app/api/v1/portfolio/[wallet]/route");

const URL_BASE = "https://aroma.example";
const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`${URL_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const quoteBody = {
  target: { kind: "spot", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: "10",
  taker: "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz",
  supportedTransactionVersions: [0],
};

describe("v1 trade routes", () => {
  beforeEach(() => {
    vi.stubEnv("AROMA_V1_ENABLED", "true");
    service.quoteTrade.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("404 for every route while the v1 flag is off", async () => {
    vi.stubEnv("AROMA_V1_ENABLED", "false");
    const responses = await Promise.all([
      quote.POST(post("/api/v1/trade/quote", quoteBody)),
      submit.POST(post("/api/v1/trade/submit", {})),
      status.GET(new Request(`${URL_BASE}/api/v1/trade/x`), {
        params: Promise.resolve({ id: "x" }),
      }),
      portfolio.GET(new Request(`${URL_BASE}/api/v1/portfolio/x`), {
        params: Promise.resolve({ wallet: "x" }),
      }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(service.quoteTrade).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin Origin on state-changing routes (AUDIT M-6)", async () => {
    const response = await submit.POST(
      post("/api/v1/trade/submit", {}, { origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "ORIGIN_FORBIDDEN",
      message: "This browser origin is not allowed.",
    });
  });

  it("parses the body and returns only { code, message } on errors (AUDIT M-5)", async () => {
    const bad = await quote.POST(
      post(
        "/api/v1/trade/quote",
        { ...quoteBody, amount: "1e9" },
        { origin: URL_BASE },
      ),
    );
    expect(bad.status).toBe(400);
    expect(Object.keys(await bad.json()).sort()).toEqual(["code", "message"]);
    service.quoteTrade.mockRejectedValue(
      new Error("RPC https://secret.invalid exploded"),
    );
    const failed = await quote.POST(post("/api/v1/trade/quote", quoteBody));
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toMatch(/secret/);
    service.quoteTrade.mockResolvedValue({ requestId: "r" });
    const ok = await quote.POST(post("/api/v1/trade/quote", quoteBody));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
  });

  it("validates the trade id and the wallet parameter", async () => {
    const id = await status.GET(new Request(`${URL_BASE}/api/v1/trade/nope`), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(id.status).toBe(400);
    const wallet = await portfolio.GET(
      new Request(`${URL_BASE}/api/v1/portfolio/0x1`),
      {
        params: Promise.resolve({ wallet: "0x1" }),
      },
    );
    expect(wallet.status).toBe(400);
  });

  it("submit answers 202 while pending and 200 when final", async () => {
    const body = { authorization: "a", signedTransactions: ["AAAA"] };
    service.submitSignedTrade.mockResolvedValueOnce({ status: "pending" });
    expect((await submit.POST(post("/api/v1/trade/submit", body))).status).toBe(
      202,
    );
    service.submitSignedTrade.mockResolvedValueOnce({ status: "confirmed" });
    expect((await submit.POST(post("/api/v1/trade/submit", body))).status).toBe(
      200,
    );
  });
});
