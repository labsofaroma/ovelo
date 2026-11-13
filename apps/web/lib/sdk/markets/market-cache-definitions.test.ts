import { expect, test } from "vitest";
import { createAromaCore } from "../state/aroma-core";
import { resolveAllMarketBaskets, type MarketSnapshot } from "./index";
const cached: MarketSnapshot = {
  network: "mainnet-beta",
  assets: [],
  baskets: [],
  asOf: "2026-09-30T01:00:00.000Z",
  status: "partial",
  sources: [],
  warnings: ["Prices unavailable"],
};
test("persisted and fresh snapshots use current definitions without changing observed prices or timestamps", async () => {
  const writes = new Map<string, string>();
  const core = createAromaCore({
    storage: {
      getItem: (key) =>
        key === "market"
          ? JSON.stringify({ snapshot: cached, etag: "old", cachedAt: 1 })
          : null,
      setItem: (key, value) => {
        writes.set(key, value);
      },
    },
    client: {
      getMarkets: async () => ({
        notModified: false,
        etag: "fresh",
        data: cached,
      }),
    },
    accountKey: "paper",
    watchlistKey: "watch",
    marketKey: "market",
    now: () => 1,
  });
  await core.hydrate();
  expect(core.getSnapshot().market?.baskets).toEqual(
    resolveAllMarketBaskets([]),
  );
  expect(core.getSnapshot().market?.asOf).toBe(cached.asOf);
  expect(core.getSnapshot().customBaskets.length).toBe(0);
  await core.refresh();
  await core.flush();
  expect(core.getSnapshot().market?.assets).toBe(cached.assets);
  expect(
    core
      .getSnapshot()
      .market?.baskets.some((basket) => basket.id === "sol-digital-economy"),
  ).toBeTruthy();
  expect(
    core
      .getSnapshot()
      .market?.baskets.every(
        (basket) => !basket.available && !basket.liquidityAudit,
      ),
  ).toBeTruthy();
  const persisted = JSON.parse(writes.get("market")!);
  expect(persisted.snapshot.asOf).toBe(cached.asOf);
  expect(persisted.snapshot.baskets).toEqual(resolveAllMarketBaskets([]));
});
