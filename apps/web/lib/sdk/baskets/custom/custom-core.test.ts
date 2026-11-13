import { expect, test } from "vitest";
import { createAromaCore } from "../../index";
import type { MarketSnapshot } from "../../markets";
import { testSnapshot } from "../../markets/test-fixtures";
import type { StorageAdapter } from "../../state/aroma-core";
import type { ProgrammableBasket } from "./types";

const STAMP = "2026-09-12T12:00:00.000Z";

test("AromaCore saves, hydrates and deletes custom baskets", async () => {
  const store = new Map<string, string>();
  const storage: StorageAdapter = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => {
      store.set(key, val);
    },
  };

  const client = {
    getMarkets: async () => ({
      notModified: false as const,
      etag: null,
      data: testSnapshot() as MarketSnapshot,
    }),
  };
  const core = createAromaCore({
    storage,
    client,
    accountKey: "test.account",
    watchlistKey: "test.watch",
    customBasketsKey: "test.custom",
  });

  await core.hydrate();
  expect(core.getSnapshot().customBaskets.length).toBe(0);

  const basket: ProgrammableBasket = {
    id: "my-custom-ai",
    name: "AI Duo",
    ticker: "AIDUO",
    description: "Top AI duo",
    allocations: [
      {
        mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
        symbol: "AAPL",
        weightBps: 5000,
      },
      {
        mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
        symbol: "NVDA",
        weightBps: 5000,
      },
    ],
    rebalanceRules: { driftThresholdBps: 500 },
    createdAt: STAMP,
    updatedAt: STAMP,
    isCustom: true,
  };

  core.saveCustomBasket(basket);
  await core.flush();

  expect(core.getSnapshot().customBaskets.length).toBe(1);
  expect(core.getCustomBasket("my-custom-ai")?.name).toBe("AI Duo");

  core.deleteCustomBasket("my-custom-ai");
  await core.flush();

  expect(core.getSnapshot().customBaskets.length).toBe(0);
});
