import { afterEach, describe, expect, it, vi } from "vitest";
import { toMarketsView } from "@/features/markets/normalize";
import { snapshot } from "@/features/test/fixtures";
import { isV1Enabled, resetEnvCacheForTests } from "@/server/env";
import { actionsJsonRules } from "./actions-json";
import { AppError } from "@/server/errors";

/** M5b B4: the v1 Action routes and the actions.json rule, gated by AROMA_V1_ENABLED. */
const quote = vi.hoisted(() => ({ fn: vi.fn() }));
// M9: the compliance gate has its own route tests (features/compliance/routes.test.ts).
vi.mock("@/features/compliance/server/gate", () => ({
  assertTradeCompliance: vi.fn(async () => {}),
  assertJurisdiction: vi.fn(),
  requestJurisdiction: vi.fn(() => ({ status: "allowed", country: "DE" })),
}));
// Phase A: the beta gate has its own route tests (features/beta/routes.test.ts).
vi.mock("@/features/beta/server/gate", () => ({
  assertTradeAccess: vi.fn(async () => {}),
}));
vi.mock("@/features/compliance/server/deps", () => ({
  complianceDeps: () => ({ policy: () => ({}) }),
}));
// Phase A caps (W3) have their own route tests (features/caps/routes.test.ts).
vi.mock("@/features/caps/server/caps", () => ({
  checkQuoteCaps: vi.fn(async () => ({})),
  requestedRaw: () => null,
  reserveForSubmit: vi.fn(async () => "reserved"),
  reserveActionQuote: vi.fn(async () => {}),
  settleReservation: vi.fn(async () => {}),
  settleAfterThrow: vi.fn(async () => {}),
}));
vi.mock("@/features/markets/server", () => ({
  getMarkets: async () => ({ state: "ok", data: toMarketsView(snapshot()) }),
}));
vi.mock("@/features/trade/server/service", () => ({
  quoteTrade: (...args: unknown[]) => quote.fn(...args),
}));

const actions = await import("@/app/api/v1/actions/baskets/[id]/route");
const confirm = await import("@/app/api/v1/actions/baskets/[id]/confirm/route");

const ACCOUNT = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const flag = (on: boolean) => {
  vi.stubEnv("AROMA_V1_ENABLED", on ? "true" : "");
  vi.stubEnv("AROMA_SITE_URL", "https://aroma.example");
  resetEnvCacheForTests();
};
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
  quote.fn.mockReset();
});

describe("flag off", () => {
  it("every v1 Action route is 404 with Action headers; actions.json lists no rule", async () => {
    flag(false);
    const get = await actions.GET(
      new Request("https://aroma.example/api/v1/actions/baskets/test-basket"),
      params("test-basket"),
    );
    expect(get.status).toBe(404);
    expect(get.headers.get("x-action-version")).toBe("2.4");
    const post = await confirm.POST(
      new Request(
        "https://aroma.example/api/v1/actions/baskets/test-basket/confirm",
        { method: "POST", body: "{}" },
      ),
      params("test-basket"),
    );
    expect(post.status).toBe(404);
    // M9 Step 3: the prototype rules went with the prototype's Action routes (410).
    expect(actionsJsonRules(isV1Enabled())).toEqual([]);
  });
});

describe("flag on", () => {
  it("actions.json maps /basket/* (and the old /v1/basket/* links) to the v1 Action, nothing else", async () => {
    flag(true);
    expect(actionsJsonRules(isV1Enabled())).toEqual([
      { pathPattern: "/basket/*", apiPath: "/api/v1/actions/baskets/*" },
      { pathPattern: "/v1/basket/*", apiPath: "/api/v1/actions/baskets/*" },
    ]);
  });

  it("GET returns metadata for a curated basket; unknown is 404 { code, message }", async () => {
    flag(true);
    const ok = await actions.GET(
      new Request("https://aroma.example/x"),
      params("test-basket"),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { title: string }).title).toMatch(
      /Test basket/,
    );
    const missing = await actions.GET(
      new Request("https://aroma.example/x"),
      params("nope"),
    );
    expect(missing.status).toBe(404);
    expect(Object.keys((await missing.json()) as object).sort()).toEqual([
      "code",
      "message",
    ]);
  });

  it("POST quotes through the M4 trade server and returns the unsigned transaction", async () => {
    flag(true);
    quote.fn.mockResolvedValue({
      authorization: "at1.a.b.c",
      transactions: ["dHg="],
      mode: "single",
      quote: { inAmount: "1", maxDebit: "2", legs: [] },
    });
    const response = await actions.POST(
      new Request(
        "https://aroma.example/api/v1/actions/baskets/test-basket?amount=2",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account: ACCOUNT }),
        },
      ),
      params("test-basket"),
    );
    expect(response.status).toBe(200);
    expect(quote.fn).toHaveBeenCalledWith(
      expect.objectContaining({
        taker: ACCOUNT,
        amount: "2",
        target: { kind: "basket", basketId: "test-basket" },
      }),
    );
    expect(await response.json()).toMatchObject({
      type: "transaction",
      transaction: "dHg=",
    });
  });

  it("a trade-server refusal (e.g. an archived creator basket) comes back as { code, message }", async () => {
    flag(true);
    quote.fn.mockRejectedValue(
      new AppError("ASSET_UNAVAILABLE", {
        publicMessage:
          "This basket was archived by its creator and can no longer be bought.",
      }),
    );
    const response = await actions.POST(
      new Request("https://aroma.example/x?amount=2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: ACCOUNT }),
      }),
      params("test-basket"),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: "ASSET_UNAVAILABLE",
      message:
        "This basket was archived by its creator and can no longer be bought.",
    });
  });
});
