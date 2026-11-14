import { expect, test } from "vitest";
import { classifyJupiterRouteError, routeProbeAmount } from "./route-health";

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
