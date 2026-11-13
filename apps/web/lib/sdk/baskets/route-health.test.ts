import { expect, test } from "vitest";
import { classifyJupiterRouteError, routeProbeAmount } from "./route-health";
import { AromaClient } from "../client/aroma-client";

test("finite amount bands round up in exact raw funding units", () => {
  expect(routeProbeAmount(25_000_000n, 6)).toBe("25000000");
  expect(routeProbeAmount(25_000_001n, 6)).toBe("50000000");
  expect(routeProbeAmount(1n, 6)).toBe("1000000");
  expect(routeProbeAmount(100_000_001n, 9)).toBe("250000000");
  expect(() => routeProbeAmount(0n, 6)).toThrow();
  expect(() => routeProbeAmount(100_000_000_001n, 6)).toThrow(/exceeds/);
});

test("provider errors never infer illiquidity from unknown failures", () => {
  expect(classifyJupiterRouteError(400, { errorCode: "NO_ROUTES_FOUND" })).toBe(
    "no-route",
  );
  expect(classifyJupiterRouteError(400, { error: "No routes found" })).toBe(
    "no-route",
  );
  expect(
    classifyJupiterRouteError(400, {
      errorCode: "ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT",
    }),
  ).toBe("liquidity");
  expect(
    classifyJupiterRouteError(400, {
      errorCode: "MAX_ACCOUNT_GREATER_THAN_MAX",
    }),
  ).toBe("capacity");
  expect(
    classifyJupiterRouteError(400, { errorCode: "TOKEN_NOT_TRADABLE" }),
  ).toBe("unavailable");
  for (const status of [401, 403, 429, 500, 503]) {
    expect(
      classifyJupiterRouteError(status, { errorCode: "NO_ROUTES_FOUND" }),
    ).toBe("unknown");
  }
  expect(
    classifyJupiterRouteError(400, { error: "Could not get pool liquidity" }),
  ).toBe("unknown");
  expect(classifyJupiterRouteError(400, null)).toBe("unknown");
});

test("shared web/native transport rejects a wrong allocation or malformed health response", async () => {
  const input = {
    inputMint: "input",
    amount: "30",
    slippageBps: 100,
    allocations: [
      { mint: "one", weightBps: 5000 },
      { mint: "two", weightBps: 5000 },
    ],
  };
  const health = {
    network: "mainnet-beta",
    inputMint: "input",
    inputSymbol: "USDC",
    inputDecimals: 6,
    amount: "30",
    slippageBps: 100,
    advisory: true,
    legs: ["one", "two"].map((mint) => ({
      mint,
      symbol: mint,
      allocatedAmount: "15000000",
      probeAmount: "25000000",
      status: "routable",
      checkedAt: 1000,
      expiresAt: 301000,
      maxAccounts: 32,
      consistent: false,
      liquidityUsd: null,
      detail: "Observed route",
    })),
  };
  let response: unknown = health;
  const client = new AromaClient({
    fetcher: async () => Response.json(response),
  });
  expect((await client.requestBasketRouteHealth(input)).legs.length).toBe(2);
  for (const invalid of [
    { ...health, inputMint: "different" },
    { ...health, network: "devnet" },
    { ...health, inputDecimals: 500 },
    { ...health, legs: health.legs.slice(0, 1) },
    { ...health, legs: [...health.legs].reverse() },
    {
      ...health,
      legs: health.legs.map((leg) => ({ ...leg, status: "illiquid" })),
    },
    {
      ...health,
      legs: health.legs.map((leg) => ({ ...leg, probeAmount: "invalid" })),
    },
  ]) {
    response = invalid;
    await await expect(client.requestBasketRouteHealth(input)).rejects.toThrow(
      /invalid response/,
    );
  }
});
