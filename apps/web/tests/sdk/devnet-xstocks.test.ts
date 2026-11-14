// @ts-nocheck -- Migrated provisioning fixtures intentionally exercise malformed wire inputs.
// M6: the cases that tested scripts/create-devnet-xstocks.cjs (never committed) and the catalog
// defect are retired; see REWRITE-PLAN "M6 status", A2. The cases below test lib/sdk/devnet-xstocks.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PublicKey } = require("@solana/web3.js");
const {
  DEVNET_GENESIS_HASH,
  DEVNET_FUNDING_TOKEN_DEFINITION,
  DEVNET_XSTOCK_CATALOG,
  DEVNET_RECURRING_BASKETS,
  createUnprovisionedDevnetManifest,
  validateDevnetXStockManifest,
  resolveDevnetBasketAssets,
} = require("../../lib/sdk/devnet-xstocks");
const { resolveMarketBaskets } = require("../../lib/sdk/markets");
function fixtureMint(index) {
  return new PublicKey(
    Uint8Array.from({ length: 32 }, (_, byte) => (byte === 0 ? index + 1 : 0)),
  ).toBase58();
}
function provisionedManifest() {
  return {
    ...createUnprovisionedDevnetManifest(),
    status: "ready",
    mintAuthority: fixtureMint(99),
    tokens: DEVNET_XSTOCK_CATALOG.map((definition, index) => ({
      ...definition,
      mint: fixtureMint(index),
    })),
    fundingToken: { ...DEVNET_FUNDING_TOKEN_DEFINITION, mint: fixtureMint(40) },
  };
}

test("unprovisioned manifests publish intentions without fabricated mint addresses or USDC", () => {
  const manifest = createUnprovisionedDevnetManifest();
  assert.equal(validateDevnetXStockManifest(manifest), manifest);
  assert.deepEqual(manifest.tokens, []);
  assert.equal(manifest.fundingToken, null);
  assert.deepEqual(manifest.intendedCatalog, DEVNET_XSTOCK_CATALOG);
  assert.equal(manifest.intendedFundingToken.symbol, "KUSD");
  assert.ok(!manifest.intendedCatalog.some((token) => "mint" in token));
  assert.throws(
    () => resolveDevnetBasketAssets(manifest, "sol-ai-infra"),
    /not provisioned.*NVDA/,
  );
});

test("fully provisioned baskets conserve their canonical allocation; new mainnet-only constituents remain unavailable", () => {
  const manifest = provisionedManifest();
  assert.equal(validateDevnetXStockManifest(manifest), manifest);
  for (const basket of DEVNET_RECURRING_BASKETS) {
    const missing = basket.underlyingSymbols.filter(
      (symbol) =>
        !manifest.tokens.some((token) => token.underlyingSymbol === symbol),
    );
    if (missing.length) {
      assert.throws(
        () => resolveDevnetBasketAssets(manifest, basket.id),
        (error) => missing.every((symbol) => error.message.includes(symbol)),
      );
      continue;
    }
    const allocations = resolveDevnetBasketAssets(manifest, basket.id);
    assert.deepEqual(
      allocations.map(({ token }) => token.underlyingSymbol),
      basket.underlyingSymbols,
    );
    assert.equal(
      allocations.reduce((sum, allocation) => sum + allocation.weightBps, 0),
      10_000,
    );
    assert.ok(
      Math.max(...allocations.map((asset) => asset.weightBps)) -
        Math.min(...allocations.map((asset) => asset.weightBps)) <=
        1,
    );
  }
  assert.throws(
    () => resolveDevnetBasketAssets(manifest, "sol-pre-stocks"),
    /Only public/,
  );
});

test("missing basket constituents fail closed instead of redistributing their allocation", () => {
  const manifest = provisionedManifest();
  manifest.tokens = manifest.tokens.filter(
    (token) => token.underlyingSymbol !== "ORCL",
  );
  manifest.status = "partial";
  assert.throws(
    () => resolveDevnetBasketAssets(manifest, "sol-ai-infra"),
    /ORCL/,
  );
  assert.equal(resolveDevnetBasketAssets(manifest, "sol-core").length, 3);
});

test("manifest validation rejects cluster, decimal, duplicate, funding-token, and status mistakes", () => {
  for (const mutate of [
    (manifest) => {
      manifest.network = "mainnet-beta";
    },
    (manifest) => {
      manifest.genesisHash = "mainnet";
    },
    (manifest) => {
      manifest.tokens[0].decimals = 9;
    },
    (manifest) => {
      manifest.tokens[0].mint = "xTsla111111111111111111111111111111111111111";
    },
    (manifest) => {
      manifest.tokens[1].mint = manifest.tokens[0].mint;
    },
    (manifest) => {
      manifest.tokens[1] = manifest.tokens[0];
    },
    (manifest) => {
      manifest.fundingToken = manifest.tokens[0];
    },
    (manifest) => {
      manifest.fundingToken.symbol = "USDC";
    },
    (manifest) => {
      manifest.fundingToken.mint = manifest.tokens[0].mint;
    },
    (manifest) => {
      manifest.status = "unprovisioned";
    },
  ]) {
    const manifest = provisionedManifest();
    mutate(manifest);
    assert.throws(() => validateDevnetXStockManifest(manifest));
  }
});
