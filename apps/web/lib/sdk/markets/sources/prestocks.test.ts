import { describe, expect, test } from "vitest";
import { prestockCatalog } from "./prestocks";

const MINT = "33333333333333333333333333333333";
const OTHER = "44444444444444444444444444444444";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

/** Server-rendered Next flight payload carrying product metadata, as the issuer page does. */
function productsPage(products: unknown[]): string {
  const flight = `1:${JSON.stringify({ products })}\n`;
  return `<html><script nonce="n">self.__next_f.push(${JSON.stringify([1, flight])})</script></html>`;
}

function fetcherFor(metrics: unknown, page: string | Response) {
  return async (input: unknown): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/api/metrics"))
      return metrics instanceof Response ? metrics : json(metrics);
    if (url.endsWith("/products"))
      return page instanceof Response ? page : new Response(page);
    throw new Error(`unexpected ${url}`);
  };
}

describe("prestockCatalog", () => {
  test("joins metrics with product metadata and marks paused products non-tradable", async () => {
    const assets = await prestockCatalog({
      fetcher: fetcherFor(
        {
          metrics: [
            {
              splMint: MINT,
              symbol: "ACME",
              tokenPrice: 12.5,
              marketCapUSD: 1000,
            },
            { splMint: OTHER, symbol: "GONE", tokenPrice: 3 },
          ],
        },
        productsPage([
          {
            splMint: MINT,
            name: "Acme Inc",
            decimals: 6,
            productLogo: "/ui/acme.png",
          },
          { splMint: OTHER, name: "Gone Co", decimals: 6, skipPipeline: true },
        ]),
      ),
    });
    const acme = assets.find((a) => a.mint === MINT)!;
    expect(acme).toMatchObject({
      name: "Acme Inc",
      decimals: 6,
      logoUrl: "https://prestocks.com/ui/acme.png",
      priceUsd: 12.5,
      priceSource: "prestocks-issuer",
      marketCapUsd: 1000,
      tradingHalted: false,
      kind: "pre-ipo",
    });
    expect(acme.priceObservedAt).toBeTruthy();
    const gone = assets.find((a) => a.mint === OTHER)!;
    expect(gone.tradingHalted).toBe(true);
    expect(gone.tradingNotice).toMatch(/paused or withdrawn/);
  });

  test("without product metadata an asset is visible but trading stays disabled", async () => {
    const assets = await prestockCatalog({
      fetcher: fetcherFor(
        { metrics: [{ splMint: MINT, symbol: "ACME", tokenPrice: 1 }] },
        new Response("nope", { status: 500 }),
      ),
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      tradingHalted: true,
      name: "ACME",
      decimals: null,
    });
    expect(assets[0]!.tradingNotice).toMatch(
      /Trading is disabled until it can be verified/,
    );
  });

  test("drops entries without a valid mint or symbol and keeps unknown prices unknown", async () => {
    const assets = await prestockCatalog({
      fetcher: fetcherFor(
        {
          metrics: [
            null,
            { splMint: "short", symbol: "X" },
            { splMint: MINT },
            { splMint: MINT, symbol: "ACME", tokenPrice: -4 },
            { splMint: OTHER, symbol: "B", tokenPrice: "9" },
          ],
        },
        productsPage([
          {
            splMint: MINT,
            name: "Acme",
            decimals: 99,
            productLogo: "http://insecure.example/x.png",
          },
        ]),
      ),
    });
    expect(assets.map((a) => a.symbol)).toEqual(["ACME", "B"]);
    expect(assets[0]).toMatchObject({
      priceUsd: null,
      priceSource: null,
      priceObservedAt: null,
      decimals: null,
      logoUrl: null,
    });
    expect(assets[1]!.priceUsd).toBeNull();
  });

  test("fails closed when metrics are unavailable or malformed", async () => {
    await expect(
      prestockCatalog({ fetcher: fetcherFor({}, "") }),
    ).rejects.toThrow(/catalog response is unavailable/);
    await expect(
      prestockCatalog({ fetcher: fetcherFor(json({}, 503), "") }),
    ).rejects.toThrow(/metrics are unavailable/);
  });

  test("ignores malformed flight chunks instead of failing the catalog", async () => {
    const html = `<script>self.__next_f.push(not-json)</script><script>self.__next_f.push(${JSON.stringify([1, 'x:{"products":not json}\n'])})</script>`;
    const assets = await prestockCatalog({
      fetcher: fetcherFor(
        { metrics: [{ splMint: MINT, symbol: "ACME" }] },
        html,
      ),
    });
    expect(assets[0]!.tradingHalted).toBe(true);
  });
});
