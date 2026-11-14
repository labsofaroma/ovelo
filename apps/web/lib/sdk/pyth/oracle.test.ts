import { expect, test } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  XSTOCKS_PYTH_FEEDS,
  PythSolanaClient,
  PythHermesClient,
  PYTH_RECEIVER_PROGRAM_ID,
  PYTH_PUSH_ORACLE_PROGRAM_ID,
  fetchXStocksOracles,
  normalizeSymbol,
} from "./index";

test("token and underlying equity feed identities remain distinct and Amazon is not SOL", () => {
  const feeds = Object.values(XSTOCKS_PYTH_FEEDS);
  const ids = feeds.flatMap((feed) => [
    feed.xStockFeedId,
    feed.equityReferenceFeedId,
  ]);
  expect(new Set(ids).size).toBe(16);
  expect(ids.every((id) => /^0x[a-f0-9]{64}$/.test(id))).toBeTruthy();
  expect(XSTOCKS_PYTH_FEEDS.AMZN!.xStockFeedId).toBe(
    "0x7148fbe6e493ff2580305c92a8d7f8628c9943b11b9b253aebc24863fec290e8",
  );
  expect(XSTOCKS_PYTH_FEEDS.AMZN!.equityReferenceFeedId).toBe(
    "0xb5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a",
  );
  expect(XSTOCKS_PYTH_FEEDS.SPY!.equityReferenceFeedId).toBe(
    "0x19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5",
  );
  expect(
    !ids.includes(
      "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    ),
  ).toBeTruthy();
  expect(normalizeSymbol("XOM")).toBe("XOM");
  expect(normalizeSymbol("NFLX")).toBe("NFLX");
  expect(normalizeSymbol("xAAPL")).toBe("AAPL");
  expect(normalizeSymbol("AAPLx")).toBe("AAPL");
});
test("feed search requires an exact token symbol and oracle outages never fabricate a registry", async () => {
  const client = new PythHermesClient();
  client.searchFeeds = async () => [
    { id: "unrelated", attributes: { symbol: "Crypto.NOT_AAPLX/USD" } },
  ];
  expect(await client.getFeedDetails("AAPL")).toBe(null);
  expect(await fetchXStocksOracles()).toEqual([]);
  const original = global.fetch;
  global.fetch = async () => new Response("", { status: 503 });
  try {
    expect(await fetchXStocksOracles("https://issuer.example/oracles")).toEqual(
      [],
    );
  } finally {
    global.fetch = original;
  }
});
function account() {
  const data = Buffer.alloc(134);
  Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]).copy(data);
  data[40] = 1;
  Buffer.from(XSTOCKS_PYTH_FEEDS.NVDA!.xStockFeedId.slice(2), "hex").copy(
    data,
    41,
  );
  data.writeBigInt64LE(12345000000n, 73);
  data.writeBigUInt64LE(1000000n, 81);
  data.writeInt32LE(-8, 89);
  data.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 93);
  return { data, owner: PYTH_RECEIVER_PROGRAM_ID, executable: false };
}
test("onchain reads use the push PDA and verify receiver, discriminator, feed, full verification and age", async () => {
  let value = account();
  const client = new PythSolanaClient({
    getAccountInfo: async () => value,
  } as never);
  const feed = XSTOCKS_PYTH_FEEDS.NVDA!.xStockFeedId;
  const expected = PublicKey.findProgramAddressSync(
    [Buffer.from([0, 0]), Buffer.from(feed.slice(2), "hex")],
    PYTH_PUSH_ORACLE_PROGRAM_ID,
  )[0];
  expect(client.getPriceFeedAccountAddress(0, feed).toBase58()).toBe(
    expected.toBase58(),
  );
  const price = await client.getOnChainPrice(0, feed);
  expect(price!.price).toBe(123.45);
  expect(price!.status).toBe("unknown");
  for (const mutate of [
    (v: ReturnType<typeof account>) =>
      (v.owner = new PublicKey("11111111111111111111111111111111")),
    (v: ReturnType<typeof account>) => (v.data[0] = 0),
    (v: ReturnType<typeof account>) => (v.data[40] = 0),
    (v: ReturnType<typeof account>) => (v.data[41]! ^= 1),
    (v: ReturnType<typeof account>) => v.data.writeBigInt64LE(1n, 93),
    (v: ReturnType<typeof account>) => (v.executable = true),
  ]) {
    value = account();
    mutate(value);
    expect(await client.getOnChainPrice(0, feed)).toBe(null);
  }
  expect(() => client.getPriceFeedAccountAddress(0, "abc")).toThrow(/32-byte/);
});
