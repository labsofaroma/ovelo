import { expect, test } from "vitest";
import {
  describeRouteFailure,
  routeHealthGuidance,
  type BasketRouteHealth,
  type RouteHealthStatus,
} from "./route-health";

test("exact no-route errors name the stock and offer other funding tokens, not automatic slippage", () => {
  const message = describeRouteFailure("no-route", "USDC", "AAPLx");
  expect(message).toMatch(/No Jupiter route from USDC to AAPLx/);
  expect(message).toMatch(/Try paying with USDT or SOL/);
  expect(message).toMatch(/No assets will be skipped/);
  expect(describeRouteFailure("no-route", "SOL", "AAPLx")).toMatch(
    /Try paying with USDC or USDT/,
  );
  expect(describeRouteFailure("liquidity", "USDC", "AAPLx")).toMatch(
    /Slippage will not be increased automatically/,
  );
  expect(describeRouteFailure("unknown", "USDC", "AAPLx")).toMatch(
    /temporarily unknown/,
  );
});

function health(statuses: RouteHealthStatus[]): BasketRouteHealth {
  return {
    network: "mainnet-beta",
    inputMint: "input",
    inputSymbol: "USDC",
    inputDecimals: 6,
    amount: "100",
    slippageBps: 100,
    advisory: true,
    legs: statuses.map((status, i) => ({
      mint: `mint${i}`,
      symbol: `STOCK${i}`,
      status,
      checkedAt: 1000,
      expiresAt: 2000,
      detail: "probe",
      probeAmount: "25000000",
      allocatedAmount: "25000000",
      maxAccounts: null,
      consistent: false,
      liquidityUsd: null,
    })),
  };
}

test("cached guidance preserves mixed categories and stale or unknown data remains advisory", () => {
  const value = health(["no-route", "liquidity", "unknown"]);
  const guidance = routeHealthGuidance(value, 1500)!;
  expect(guidance).toMatch(/Cached amount-band check/);
  expect(guidance).toMatch(/No Jupiter route from USDC to STOCK0/);
  expect(guidance).toMatch(/STOCK1 cannot fill/);
  expect(guidance).not.toMatch(/STOCK2 cannot fill/);
  expect(routeHealthGuidance(value, 2001)!).toMatch(/stale/);
  expect(routeHealthGuidance(health(["unknown"]), 1500)!).toMatch(
    /temporarily unknown/,
  );
  expect(routeHealthGuidance(health(["routable"]), 1500)).toBe(null);
  expect(routeHealthGuidance(null)).toBe(null);
});
