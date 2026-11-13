const test = require("node:test");
const assert = require("node:assert/strict");
const { Keypair } = require("@solana/web3.js");
const { allocateBasketInput } = require("../../lib/sdk/basket/atomic-swap");
const {
  calculateBasketRebalance,
  calculateTimeWeightedReturn,
} = require("../../lib/sdk/rebalance");
const key = () => Keypair.generate().publicKey;

test("basket allocations conserve every unit with deterministic remainders", () => {
  const targets = [
    { mint: "a", weightBps: 3333 },
    { mint: "b", weightBps: 3333 },
    { mint: "c", weightBps: 3334 },
  ];
  for (let amount = 3n; amount <= 1000n; amount++) {
    const allocated = allocateBasketInput(amount, targets);
    assert.equal(
      allocated.reduce((sum, leg) => sum + leg.amount, 0n),
      amount,
    );
    assert.ok(allocated.every((leg) => leg.amount > 0n));
  }
  assert.deepEqual(
    allocateBasketInput(10n, targets).map((x) => x.amount),
    [3n, 3n, 4n],
  );
  assert.throws(() => allocateBasketInput(2n, targets), /too small/);
  assert.throws(
    () =>
      allocateBasketInput(10n, [
        { mint: "a", weightBps: 5000 },
        { mint: "a", weightBps: 5000 },
      ]),
    /unique/,
  );
});
test("rebalance keeps cash and asset value conserved without token float rounding", () => {
  const result = calculateBasketRebalance({
    targets: [
      { mint: "a", weightBps: 6000 },
      { mint: "b", weightBps: 4000 },
    ],
    holdings: [
      { mint: "a", valueUsdMicros: 80n },
      { mint: "b", valueUsdMicros: 10n },
    ],
    cashUsdMicros: 10n,
  });
  assert.deepEqual(
    result.legs.map((x) => x.deltaValueUsdMicros),
    [-20n, 30n],
  );
  assert.deepEqual(
    result.legs.map((x) => x.action),
    ["sell", "buy"],
  );
  assert.equal(
    result.legs.reduce((sum, x) => sum + x.deltaValueUsdMicros, 0n),
    10n,
  );
  assert.throws(
    () =>
      calculateBasketRebalance({
        targets: [{ mint: "a", weightBps: 10000 }],
        holdings: [{ mint: "unrelated", valueUsdMicros: 1n }],
      }),
    /explicitly/,
  );
  const unfunded = calculateBasketRebalance({
    targets: [
      { mint: "a", weightBps: 5000 },
      { mint: "b", weightBps: 5000 },
    ],
    holdings: [
      { mint: "a", valueUsdMicros: 51n },
      { mint: "b", valueUsdMicros: 40n },
    ],
    cashUsdMicros: 9n,
    thresholdBps: 200,
  });
  assert.equal(unfunded.fullyFunded, false);
  assert.equal(unfunded.projectedCashUsdMicros, -1n);
  assert.equal(calculateTimeWeightedReturn([]), null);
  assert.ok(
    Math.abs(
      calculateTimeWeightedReturn([
        { openingValue: 100, closingValue: 110 },
        { openingValue: 200, closingValue: 220 },
      ]) - 0.21,
    ) < 1e-10,
  );
});
