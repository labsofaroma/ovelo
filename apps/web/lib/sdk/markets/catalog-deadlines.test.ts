import { expect, test, vi } from "vitest";
import { getMainnetCatalog } from "./index";

// Virtual elapsed time avoids a slow/flaky real network timeout regression.
// Signals remain real AbortSignals, including production AbortSignal.any calls.
function issuerFixture({
  caller,
  batchMilliseconds = 4000,
}: { caller?: AbortController; batchMilliseconds?: number } = {}) {
  let elapsed = 0;
  const timeouts: { controller: AbortController; expiresAt: number }[] = [];
  const requestedPages: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(
    (milliseconds: number) => {
      const controller = new AbortController();
      timeouts.push({ controller, expiresAt: elapsed + milliseconds });
      return controller.signal;
    },
  );
  const advanceTo = (next: number) => {
    elapsed = Math.max(elapsed, next);
    for (const timeout of timeouts)
      if (timeout.expiresAt <= elapsed)
        timeout.controller.abort(
          new DOMException("Deadline exceeded", "TimeoutError"),
        );
  };
  const json = (value: unknown) => new Response(JSON.stringify(value));
  const fetcher = async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.xstocks.fi") {
      if (url.pathname === "/api/metrics") return json({ metrics: [] });
      if (url.pathname === "/products") return new Response("");
      return json([]);
    }
    const page = Number(url.searchParams.get("page"));
    requestedPages.push(page);
    await Promise.resolve();
    if (page === 3 && caller) caller.abort();
    advanceTo((Math.floor(page / 3) + 1) * batchMilliseconds);
    init?.signal?.throwIfAborted();
    return json({
      nodes: [
        {
          symbol: `T${page}x`,
          name: `Issuer ${page}`,
          deployments: [
            {
              network: "Solana",
              address: "1".repeat(30) + "ABCDEFGHJ"[page] + "1",
            },
          ],
        },
      ],
      page: { hasNextPage: page < 8 },
    });
  };
  return { fetcher, requestedPages, elapsed: () => elapsed };
}

test("healthy paginated issuer catalog survives twelve seconds of cold responses", async () => {
  const fixture = issuerFixture();
  const catalog = await getMainnetCatalog({ fetcher: fixture.fetcher });
  expect(fixture.elapsed()).toBe(12000);
  expect(
    catalog.assets.filter((asset) => asset.issuer === "xstocks").length,
  ).toBe(9);
  expect(catalog.sources.includes("xStocks issuer catalog")).toBeTruthy();
  expect(fixture.requestedPages).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("caller cancellation still stops pagination before the longer catalog deadline", async () => {
  const caller = new AbortController();
  const fixture = issuerFixture({ caller });
  const catalog = await getMainnetCatalog({
    fetcher: fixture.fetcher,
    signal: caller.signal,
  });
  expect(catalog.assets.some((asset) => asset.issuer === "xstocks")).toBe(
    false,
  );
  expect(catalog.sources.includes("xStocks issuer catalog")).toBe(false);
  expect(fixture.requestedPages.every((page: number) => page < 6)).toBeTruthy();
  expect(
    catalog.warnings.some((warning) => warning.startsWith("xStocks catalog")),
  ).toBeTruthy();
});

test("catalog pagination remains bounded when provider batches exceed twenty seconds", async () => {
  const fixture = issuerFixture({ batchMilliseconds: 7500 });
  const catalog = await getMainnetCatalog({ fetcher: fixture.fetcher });
  expect(catalog.assets.some((asset) => asset.issuer === "xstocks")).toBe(
    false,
  );
  expect(catalog.sources.includes("xStocks issuer catalog")).toBe(false);
  expect(
    catalog.warnings.some((warning) => warning.startsWith("xStocks catalog")),
  ).toBeTruthy();
});

// Mock global fetch to exercise the production concurrent loader, including
// successful first pages followed by required-page failures.
function productionFixture(respond: (page: number) => Response) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.xstocks.fi") {
      if (url.pathname === "/api/metrics")
        return Response.json({ metrics: [] });
      if (url.pathname === "/products") return new Response("");
      return Response.json([]);
    }
    return respond(Number(url.searchParams.get("page")));
  });
}

const pagePayload = (
  page: number,
  hasNextPage: boolean,
): { nodes: unknown[]; page?: { hasNextPage: boolean } } => ({
  nodes: [
    {
      symbol: `P${page}x`,
      name: `Page ${page}`,
      deployments: [
        {
          network: "Solana",
          address: "1".repeat(30) + "ABCDEFGHJ"[page] + "1",
        },
      ],
    },
  ],
  page: { hasNextPage },
});

test("a failed required concurrent page never becomes a live cached issuer catalog", async () => {
  productionFixture((page: number) =>
    page === 1
      ? new Response("Unavailable", { status: 503 })
      : Response.json(pagePayload(page, true)),
  );
  const catalog = await getMainnetCatalog();
  expect(catalog.sources.includes("xStocks issuer catalog")).toBe(false);
  expect(catalog.assets.some((a) => a.issuer === "xstocks")).toBe(false);
});

test("a deep page failure also discards the incomplete prefix", async () => {
  productionFixture((page: number) =>
    page === 3
      ? new Response("Unavailable", { status: 503 })
      : Response.json(pagePayload(page, true)),
  );
  const catalog = await getMainnetCatalog();
  expect(catalog.sources.includes("xStocks issuer catalog")).toBe(false);
  expect(catalog.assets.some((a) => a.issuer === "xstocks")).toBe(false);
});

test("missing pagination metadata is rejected instead of declaring the first page complete", async () => {
  productionFixture((page: number) => {
    const payload = pagePayload(page, true);
    delete payload.page;
    return Response.json(payload);
  });
  const catalog = await getMainnetCatalog();
  expect(catalog.sources.includes("xStocks issuer catalog")).toBe(false);
});

test("an explicit last page completes the catalog even if speculative later pages fail", async () => {
  productionFixture((page: number) =>
    page === 2
      ? new Response("Past the end", { status: 404 })
      : Response.json(pagePayload(page, page === 0)),
  );
  const catalog = await getMainnetCatalog();
  expect(catalog.sources.includes("xStocks issuer catalog")).toBeTruthy();
  expect(catalog.assets.filter((a) => a.issuer === "xstocks").length).toBe(2);
  expect(catalog.issuerCatalogVersion).toBe(1);
});
