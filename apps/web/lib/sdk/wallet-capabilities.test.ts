import { expect, test } from "vitest";
import { advertisedSigningVersions } from "./wallet-capabilities";
test("only the advertised signing method can enable a transaction version", () => {
  expect(advertisedSigningVersions(["legacy", 0, 1], true)).toEqual([0, 1]);
  expect(advertisedSigningVersions(["1"], true)).toEqual([1]);
  expect(advertisedSigningVersions([1], false)).toEqual([]);
  expect(advertisedSigningVersions(undefined, true)).toEqual([]);
  expect(advertisedSigningVersions([0, "legacy", 2, NaN, "01"], true)).toEqual([0]);
});
