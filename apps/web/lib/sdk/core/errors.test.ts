import { expect, test } from "vitest";
import { describeSimulationFailure } from "./errors";

const jupiter = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const other = "11111111111111111111111111111111";
const custom = (code: number) => ({ InstructionError: [3, { Custom: code }] });
const failed = (program: string, code: number) => [
  `Program ${program} invoke [1]`,
  `Program ${program} failed: custom program error: 0x${code.toString(16)}`,
];

test("simulation distinguishes SOL fees/rent, funding balance, slippage, expiration and limits", () => {
  expect(describeSimulationFailure("InsufficientFundsForFee")).toMatch(
    /Not enough SOL/,
  );
  expect(describeSimulationFailure(custom(1), failed(other, 1))).toMatch(
    /any SOL purchase amount/,
  );
  expect(
    describeSimulationFailure({
      InsufficientFundsForRent: { account_index: 1 },
    }),
  ).toMatch(/token-account rent/);
  expect(
    describeSimulationFailure(custom(6024), failed(jupiter, 6024)),
  ).toMatch(/insufficient funds/);
  expect(
    describeSimulationFailure(custom(6001), failed(jupiter, 6001)),
  ).toMatch(/selected slippage/);
  expect(
    describeSimulationFailure(custom(6017), failed(jupiter, 6017)),
  ).toMatch(/Slippage was not changed/);
  expect(describeSimulationFailure("BlockhashNotFound")).toMatch(
    /Refresh the review/,
  );
  expect(
    describeSimulationFailure({
      InstructionError: [1, "ComputationalBudgetExceeded"],
    }),
  ).toMatch(/compute limit/);
  expect(describeSimulationFailure("TooManyAccountLocks")).toMatch(
    /account or data limits/,
  );
  expect(
    describeSimulationFailure(custom(6025), failed(jupiter, 6025)),
  ).toMatch(/missing or incompatible/);
});

test("unscoped, mismatched and CPI custom codes never falsely claim Jupiter slippage or illiquidity", () => {
  for (const logs of [
    undefined,
    failed(other, 6001),
    failed(jupiter, 6024),
    [
      `Program ${jupiter} invoke [1]`,
      ...failed(other, 6001).map((line) => line.replace("[1]", "[2]")),
      `Program ${jupiter} failed: custom program error: 0x1771`,
    ],
  ]) {
    const message = describeSimulationFailure(custom(6001), logs);
    expect(message).toMatch(/instruction 4, program error 6001/);
    expect(message).toMatch(/liquidity is unknown/);
    expect(message).not.toMatch(/selected slippage|insufficient funds/);
  }
});

test("earlier failures and raw provider log details do not leak into the final error", () => {
  const logs = [
    ...failed(jupiter, 6001),
    ...failed(other, 6001),
    "secret-provider-details",
  ];
  expect(describeSimulationFailure(custom(6001), logs)).toMatch(
    /liquidity is unknown/,
  );
  expect(
    describeSimulationFailure(
      { privateEndpoint: "secret-provider-details" },
      logs,
    ),
  ).not.toMatch(/secret-provider-details/);
});
