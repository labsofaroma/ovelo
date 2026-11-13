import { expect, test } from "vitest";
import {
  allocateBasketInput,
  basketInputDebitBounds,
  validateBasketInputDebit,
} from "./atomic-swap";

test("20,000 reviewed units can settle for 19,999 or 19,989 without overspending", () => {
  expect(validateBasketInputDebit(20_000n, 19_999n)).toBe(1n);
  expect(validateBasketInputDebit(20_000n, 19_989n)).toBe(11n);
  expect(validateBasketInputDebit(20_000n, 20_000n)).toBe(0n);
});

test("Hare allocations conserve the full budget before settlement dust", () => {
  const legs = allocateBasketInput(20_000n, [
    { mint: "a", weightBps: 3334 },
    { mint: "b", weightBps: 3333 },
    { mint: "c", weightBps: 3333 },
  ]);
  expect(legs.map((leg) => leg.amount)).toEqual([6668n, 6666n, 6666n]);
  expect(legs.reduce((sum, leg) => sum + leg.amount, 0n)).toBe(20_000n);
  expect(validateBasketInputDebit(20_000n, 19_989n)).toBe(11n);
});

test("debits are bounded to 50 units above and 100 units below the allocation", () => {
  expect(basketInputDebitBounds(20_000n)).toEqual({
    minimum: 19_900n,
    maximum: 20_050n,
  });
  expect(validateBasketInputDebit(2_000_000n, 1_999_997n)).toBe(3n);
  expect(validateBasketInputDebit(20_000n, 19_900n)).toBe(100n);
  expect(validateBasketInputDebit(20_000n, 20_050n)).toBe(-50n);
  expect(() => validateBasketInputDebit(20_000n, 19_899n)).toThrow();
  expect(() => validateBasketInputDebit(20_000n, 20_051n)).toThrow();
  expect(validateBasketInputDebit(9999n, 9998n)).toBe(1n);
});

test("out-of-range spending, zero and negative debits remain invalid", () => {
  for (const spent of [20_051n, 19_899n, 10_000n, 0n, -1n])
    expect(() => validateBasketInputDebit(20_000n, spent)).toThrow();
  for (const reviewed of [0n, -1n, 1n << 64n])
    expect(() => validateBasketInputDebit(reviewed, 1n)).toThrow();
});

test("debit validation keeps u64 precision without Number conversion", () => {
  const reviewed = (1n << 64n) - 1n;
  expect(validateBasketInputDebit(reviewed, reviewed - 13n)).toBe(13n);
  expect(() => validateBasketInputDebit(reviewed, reviewed + 1n)).toThrow();
  expect(() => validateBasketInputDebit(reviewed + 1n, 1n)).toThrow();
  expect(basketInputDebitBounds(reviewed)).toEqual({
    minimum: reviewed - 100n,
    maximum: reviewed,
  });
  expect(basketInputDebitBounds(1n)).toEqual({ minimum: 1n, maximum: 51n });
});
