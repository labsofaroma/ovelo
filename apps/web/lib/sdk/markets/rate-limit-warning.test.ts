import { expect, test } from "vitest";
import { JUPITER_RATE_LIMITED_WARNING, getMainnetMarkets } from "./index";
import { MarketHttpError, isRateLimited } from "./http";

// M3-SDK-REQUESTS #4: rate limiting gets its own warning, distinct from "provider down".
const mintA = "11111111111111111111111111111111";
const j = (value: unknown) =>
  new Response(JSON.stringify(value), { status: 200 });

function fetcherWith(jupiterStatus: number) {
  return async (input: unknown) => {
    const url = String(input);
    if (url.includes("api.backpack.exchange")) return j([]);
    if (url.includes("xstocks.fi"))
      return j({
        nodes: [
          {
            symbol: "Ax",
            name: "A",
            deployments: [{ network: "Solana", address: mintA }],
          },
        ],
        page: { hasNextPage: false },
      });
    if (url.endsWith("/products")) return new Response("");
    if (url.endsWith("/api/metrics")) return j({ metrics: [] });
    // Every Jupiter call fails with the given status (a 429 is retried once, then fails again).
    return new Response("", {
      status: jupiterStatus,
      headers: { "retry-after": "0.1" },
    });
  };
}

test("HTTP 429 from Jupiter yields the distinct rate-limit warning", async () => {
  const snapshot = await getMainnetMarkets({ fetcher: fetcherWith(429) });
  expect(snapshot.status).toBe("partial");
  expect(snapshot.warnings).toContain(JUPITER_RATE_LIMITED_WARNING);
  expect(snapshot.warnings.join(" ")).not.toMatch(
    /prices and token metadata are unavailable/,
  );
});

test("other Jupiter failures keep the generic outage warnings", async () => {
  const snapshot = await getMainnetMarkets({ fetcher: fetcherWith(503) });
  expect(snapshot.warnings).not.toContain(JUPITER_RATE_LIMITED_WARNING);
  expect(snapshot.warnings.join(" ")).toMatch(
    /prices and token metadata are unavailable/,
  );
});

test("isRateLimited only matches a 429 MarketHttpError", () => {
  expect(isRateLimited(new MarketHttpError(429))).toBe(true);
  expect(isRateLimited(new MarketHttpError(500))).toBe(false);
  expect(isRateLimited(new Error("HTTP 429"))).toBe(false);
});
