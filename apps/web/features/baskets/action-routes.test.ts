import type * as BasketActions from "@/features/baskets/actions";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toMarketsView } from "@/features/markets/normalize";
import { snapshot } from "@/features/test/fixtures";
import { resetEnvCacheForTests } from "@/server/env";
import { stubBaseEnv } from "@/server/test/base-env";
import { actionsJsonRules } from "./actions-json";
import { AppError } from "@/server/errors";

/** M5b B4: the v1 Action routes and the actions.json rules. */
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

// The quote is mocked with a placeholder transaction; the message hash is unit-tested in actions.test.ts.
vi.mock("@/features/baskets/actions", async (orig) => ({
  ...(await orig<typeof BasketActions>()),
  actionMessageHash: () => "ab".repeat(32),
}));

const actions = await import("@/app/api/v1/actions/baskets/[id]/route");

const ACCOUNT = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const setup = () => {
  stubBaseEnv();
  vi.stubEnv("OVELO_SITE_URL", "https://ovelo.example");
  resetEnvCacheForTests();
};
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
  quote.fn.mockReset();
});

describe("v1 Actions", () => {
  it("actions.json maps /basket/* (and the old /v1/basket/* links) to the v1 Action, nothing else", async () => {
    setup();
    expect(actionsJsonRules()).toEqual([
      { pathPattern: "/basket/*", apiPath: "/api/v1/actions/baskets/*" },
      { pathPattern: "/v1/basket/*", apiPath: "/api/v1/actions/baskets/*" },
    ]);
  });

  it("GET returns metadata for a curated basket; unknown is 404 { code, message }", async () => {
    setup();
    const ok = await actions.GET(
      new Request("https://ovelo.example/x"),
      params("test-basket"),
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { title: string }).title).toMatch(
      /Test basket/,
    );
    const missing = await actions.GET(
      new Request("https://ovelo.example/x"),
      params("nope"),
    );
    expect(missing.status).toBe(404);
    expect(Object.keys((await missing.json()) as object).sort()).toEqual([
      "code",
      "message",
    ]);
  });

  it("POST quotes through the M4 trade server and returns the unsigned transaction", async () => {
    setup();
    quote.fn.mockResolvedValue({
      authorization: "at1.a.b.c",
      transactions: ["dHg="],
      mode: "single",
      quote: { inAmount: "1", maxDebit: "2", legs: [] },
    });
    const response = await actions.POST(
      new Request(
        "https://ovelo.example/api/v1/actions/baskets/test-basket?amount=2",
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

  it("OVELO_ACTIONS=off disables the GET and refuses the POST before any quote", async () => {
    setup();
    vi.stubEnv("OVELO_ACTIONS", "off");
    const get = await actions.GET(
      new Request("https://ovelo.example/x"),
      params("test-basket"),
    );
    expect(await get.json()).toMatchObject({ disabled: true });
    const post = await actions.POST(
      new Request(
        "https://ovelo.example/api/v1/actions/baskets/test-basket?amount=2",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account: ACCOUNT }),
        },
      ),
      params("test-basket"),
    );
    expect(post.status).toBe(503);
    expect(quote.fn).not.toHaveBeenCalled();
  });

  it("a trade-server refusal (e.g. an archived creator basket) comes back as { code, message }", async () => {
    setup();
    quote.fn.mockRejectedValue(
      new AppError("ASSET_UNAVAILABLE", {
        publicMessage:
          "This basket was archived by its creator and can no longer be bought.",
      }),
    );
    const response = await actions.POST(
      new Request("https://ovelo.example/x?amount=2", {
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
