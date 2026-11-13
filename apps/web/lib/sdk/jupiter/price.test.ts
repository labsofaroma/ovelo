import { afterEach, describe, expect, test, vi } from "vitest";
import { JupiterPriceApiError, JupiterPriceClient } from "./price";

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: string | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("JupiterPriceClient", () => {
  test("keeps unknown precision unknown (v2 shape has no decimals)", async () => {
    mockFetch(() => json({ data: { mint: { price: "1.23" } } }));
    const info = await new JupiterPriceClient().getTokenPriceInfo("mint");
    expect(info?.usdPrice).toBe(1.23);
    expect(info?.decimals).toBeUndefined();
  });

  test("reads the v3 shape and drops non-positive, non-finite and foreign entries", async () => {
    mockFetch(() =>
      json({
        a: { usdPrice: 2.5, decimals: 6 },
        b: { usdPrice: 0 },
        c: { usdPrice: -1 },
        d: { usdPrice: "3" },
        e: null,
        notRequested: { usdPrice: 9 },
      }),
    );
    const client = new JupiterPriceClient({
      baseUrl: "https://price.example/v3/",
    });
    expect(await client.getPrices(["a", "b", "c", "d", "e"])).toEqual({
      a: 2.5,
    });
    expect(await client.getPrice("a")).toBe(2.5);
    expect(await client.getPrice("b")).toBeNull();
  });

  test("v2 entries must have a positive numeric string price", async () => {
    mockFetch(() =>
      json({
        data: {
          a: { price: "0" },
          b: { price: 5 },
          c: { price: "NaN" },
          d: { price: "4" },
        },
      }),
    );
    expect(
      await new JupiterPriceClient().getPrices(["a", "b", "c", "d"]),
    ).toEqual({ d: 4 });
  });

  test("chunks requests into batches of 50 and merges results", async () => {
    const spy = mockFetch((url) => {
      const ids = new URL(url).searchParams.get("ids")!.split(",");
      return json(Object.fromEntries(ids.map((id) => [id, { usdPrice: 1 }])));
    });
    const mints = Array.from({ length: 120 }, (_, i) => `m${i}`);
    const result = await new JupiterPriceClient().getPricesWithDetails(mints);
    expect(Object.keys(result)).toHaveLength(120);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  test("makes no request for an empty list", async () => {
    const spy = mockFetch(() => json({}));
    expect(await new JupiterPriceClient().getPricesWithDetails([])).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  test("sends the API key header and uses the configured base URL", async () => {
    const spy = mockFetch(() => json({}));
    await new JupiterPriceClient({
      apiKey: "k",
      baseUrl: "https://price.example/v3///",
    }).getPrices(["a"]);
    expect(spy.mock.calls[0]![0]).toBe("https://price.example/v3//?ids=a");
    expect(
      (spy.mock.calls[0]![1]!.headers as Record<string, string>)["x-api-key"],
    ).toBe("k");
  });

  test("raises typed errors with the status for rate limits and other failures", async () => {
    mockFetch(() => json({}, 429));
    await expect(
      new JupiterPriceClient().getPrices(["a"]),
    ).rejects.toMatchObject({
      name: "JupiterPriceApiError",
      statusCode: 429,
      message: expect.stringContaining("Rate limit"),
    });
    mockFetch(() => json({}, 500));
    const error = await new JupiterPriceClient()
      .getPrices(["a"])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JupiterPriceApiError);
    expect((error as JupiterPriceApiError).statusCode).toBe(500);
  });

  test("formatPrice picks sensible precision and passes through non-numbers", () => {
    expect(JupiterPriceClient.formatPrice(12.3456)).toBe("12.35");
    expect(JupiterPriceClient.formatPrice(0.123456)).toBe("0.1235");
    expect(JupiterPriceClient.formatPrice("2", 3)).toBe("2.000");
    expect(JupiterPriceClient.formatPrice("abc")).toBe("abc");
  });
});
