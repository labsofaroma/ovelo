import { NextRequest } from "next/server";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { betaConfig } from "@/features/beta/config";
import { normalizePath } from "@/features/beta/paths";
import { setBetaDepsForTests } from "@/features/beta/server/deps";
import type * as Invites from "@/features/beta/server/invites";
import type { BetaDb } from "@/features/beta/server/invites";
import { authorizationFor } from "@/features/beta/test/fixtures";
import { resetEnvCacheForTests } from "@/server/env";

/**
 * W2 at the edge: with the gate on, middleware refuses every trading POST for a wallet without
 * beta access (quote: body taker; Action: body account; submit: the HMAC-verified token's taker),
 * closes the prototype trading routes, fails closed without a database, and leaves reads, the
 * Action confirm callback, redeem and the devnet routes open. Location is checked first.
 */
const hasAccess = vi.hoisted(() => ({
  wallets: new Set<string>(),
  down: false,
}));
vi.mock("@/features/beta/server/invites", async (original) => ({
  ...(await original<typeof Invites>()),
  hasBetaAccess: async (_db: BetaDb, wallet: string) => {
    if (hasAccess.down) throw new Error("connection refused");
    return hasAccess.wallets.has(wallet);
  },
}));
const { middleware } = await import("@/middleware");

const ALLOWED = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AROMA_TRUST_PROXY", "true");
  vi.stubEnv("AROMA_BETA_GATE", "on");
  vi.stubEnv("AROMA_TRADE_SECRET", "s".repeat(40));
  resetEnvCacheForTests();
  hasAccess.wallets = new Set([ALLOWED]);
  hasAccess.down = false;
  setBetaDepsForTests({
    config: () => betaConfig(process.env),
    db: () => ({}) as BetaDb,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCacheForTests();
  setBetaDepsForTests({});
});

let ip = 0;
const post = (path: string, body: unknown, country = "DE", method = "POST") =>
  middleware(
    new NextRequest(`http://localhost:3000${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-real-ip": `203.0.113.${++ip % 250}`,
        "x-vercel-ip-country": country,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const code = async (response: Response) =>
  response.status === 200 ? "pass" : ((await response.json()).code as string);

// Expired on purpose: the edge only needs the verified wallet; expiry is the handler's.
const token = (taker: string) => authorizationFor(taker, Date.now() - 1);

describe("beta gate in middleware", () => {
  it("quote: no access → 403, access → passes to the handler", async () => {
    const refused = await post("/api/v1/trade/quote", { taker: OTHER });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      code: "BETA_ACCESS_REQUIRED",
      message: expect.stringMatching(/private beta/),
    });
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(
      await code(await post("/api/v1/trade/quote", { taker: ALLOWED })),
    ).toBe("pass");
  });

  it("Action POST checks the body's account and keeps the Actions headers", async () => {
    const refused = await post("/api/v1/actions/baskets/sol-core?amount=1", {
      account: OTHER,
    });
    expect(await code(refused)).toBe("BETA_ACCESS_REQUIRED");
    expect(refused.headers.get("x-action-version")).toBe("2.4");
    expect(
      await code(
        await post("/api/v1/actions/baskets/sol-core?amount=1", {
          account: ALLOWED,
        }),
      ),
    ).toBe("pass");
  });

  it("submit uses the wallet inside the verified authorization, never a body field", async () => {
    expect(
      await code(
        await post("/api/v1/trade/submit", {
          authorization: token(OTHER),
          taker: ALLOWED,
        }),
      ),
    ).toBe("BETA_ACCESS_REQUIRED");
    expect(
      await code(
        await post("/api/v1/trade/submit", { authorization: token(ALLOWED) }),
      ),
    ).toBe("pass");
    // A forged token names no verified wallet: the handler refuses it (AUTHORIZATION_INVALID,
    // features/beta/routes.test.ts) and the edge does not pretend to know the wallet.
    const forged = token(OTHER).replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(
      await code(await post("/api/v1/trade/submit", { authorization: forged })),
    ).toBe("pass");
  });

  it("a request naming no wallet goes on to the handler, which refuses it by schema", async () => {
    // The handler parses the same bytes strictly (INVALID_JSON, VALIDATION_FAILED) and checks
    // beta access itself; no such request can quote or submit.
    for (const body of ["{", "[]", "null", {}, { taker: 1 }])
      expect(await code(await post("/api/v1/trade/quote", body))).toBe("pass");
  });

  it("the database being unavailable fails closed with 503", async () => {
    hasAccess.down = true;
    expect(
      await code(await post("/api/v1/trade/quote", { taker: ALLOWED })),
    ).toBe("BETA_ACCESS_UNAVAILABLE");
  });

  it("the allowlist grants access without the database", async () => {
    hasAccess.down = true;
    vi.stubEnv("AROMA_BETA_WALLETS", OTHER);
    expect(
      await code(await post("/api/v1/trade/quote", { taker: OTHER })),
    ).toBe("pass");
  });

  it("prototype trading routes are closed while the gate is on ({ error } body)", async () => {
    for (const path of [
      "/api/trade/execute",
      "/api/buy-basket",
      "/api/bundles/execute",
    ]) {
      const response = await post(path, { wallet: ALLOWED });
      expect(response.status).toBe(403);
      expect(Object.keys(await response.json())).toEqual(["error"]);
    }
  });

  it("location comes first: a blocked country gets 451", async () => {
    expect(
      await code(await post("/api/v1/trade/quote", { taker: OTHER }, "US")),
    ).toBe("JURISDICTION_RESTRICTED");
  });

  it.each([
    "/api/v1/actions/baskets/sol-core/confirm",
    "/api/v1/beta/redeem",
    "/api/v1/compliance/terms/accept",
    "/api/v1/faucet",
  ])("%s stays open to a wallet without access", async (path) => {
    hasAccess.down = true;
    const response = await post(path, {
      taker: OTHER,
      account: OTHER,
      wallet: OTHER,
    });
    expect(["BETA_ACCESS_REQUIRED", "BETA_ACCESS_UNAVAILABLE"]).not.toContain(
      await code(response),
    );
  });

  it("the gate off changes nothing", async () => {
    vi.stubEnv("AROMA_BETA_GATE", "off");
    expect(
      await code(await post("/api/v1/trade/quote", { taker: OTHER })),
    ).toBe("pass");
    expect(await code(await post("/api/trade/execute", {}))).toBe("pass");
  });

  it("no path spelling of quote or submit reaches the handler without the check (property)", async () => {
    const spellings = fc.constantFrom(
      "/api/v1/trade/quote/",
      "//api/v1/trade/quote",
      "/api/v1//trade/quote",
      "/api/v1/trade/./quote",
      "/api/v1/x/../trade/quote",
      "/api/v1/trade/%71uote",
      "/API/v1/trade/quote",
      "/api/v1/trade/submit/",
      "/api/v1/trade/%73ubmit",
      "/api/v1/actions/baskets/sol-core/",
    );
    await fc.assert(
      fc.asyncProperty(spellings, async (path) => {
        const body = normalizePath(path).endsWith("/submit")
          ? { authorization: token(OTHER) }
          : { taker: OTHER, account: OTHER };
        // Every spelling is refused here, before any handler (no "maybe it 404s" escape).
        expect(await code(await post(path, body))).toBe("BETA_ACCESS_REQUIRED");
      }),
      { numRuns: 50 },
    );
  });
});
