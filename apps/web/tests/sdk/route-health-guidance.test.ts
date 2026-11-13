import assert from "node:assert/strict";
import test from "node:test";
import {
  describeRouteFailure,
  routeHealthGuidance,
  type BasketRouteHealth,
  type RouteHealthStatus,
} from "../../lib/sdk/basket/route-health";

test("exact no-route errors name the stock and offer other funding tokens, not automatic slippage", () => {
  const message = describeRouteFailure("no-route", "USDC", "AAPLx");
  assert.match(message, /No Jupiter route from USDC to AAPLx/);
  assert.match(message, /Try paying with USDT or SOL/);
  assert.match(message, /No assets will be skipped/);
  assert.match(
    describeRouteFailure("no-route", "SOL", "AAPLx"),
    /Try paying with USDC or USDT/,
  );
  assert.match(
    describeRouteFailure("liquidity", "USDC", "AAPLx"),
    /Slippage will not be increased automatically/,
  );
  assert.match(
    describeRouteFailure("unknown", "USDC", "AAPLx"),
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
  assert.match(guidance, /Cached amount-band check/);
  assert.match(guidance, /No Jupiter route from USDC to STOCK0/);
  assert.match(guidance, /STOCK1 cannot fill/);
  assert.doesNotMatch(guidance, /STOCK2 cannot fill/);
  assert.match(routeHealthGuidance(value, 2001)!, /stale/);
  assert.match(
    routeHealthGuidance(health(["unknown"]), 1500)!,
    /temporarily unknown/,
  );
  assert.equal(routeHealthGuidance(health(["routable"]), 1500), null);
  assert.equal(routeHealthGuidance(null), null);
});
