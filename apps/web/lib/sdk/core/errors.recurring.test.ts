import { expect, test } from "vitest";
import { describeRecurringSimulationFailure } from "./errors";

const guard = "8Fm9HENPAFnyo6L8cHJFx62HHsZ6ez6CPUDuzgKAzrjs";
const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const system = "11111111111111111111111111111111";
const custom = (code: number) => ({ InstructionError: [5, { Custom: code }] });
const failed = (program: string, code: number) => [
  `Program ${program} invoke [1]`,
  `Program ${program} failed: custom program error: 0x${code.toString(16)}`,
];

test("missing Guard instruction reports the contract mismatch, not insufficient funds", () => {
  const message = describeRecurringSimulationFailure(
    custom(101),
    failed(guard, 101),
  );
  expect(message).toMatch(/Upgrade the devnet Guard/);
  expect(message).toMatch(/Adding SOL or KUSD will not fix/);
  expect(message).not.toMatch(/pool liquidity/);
});

test("unscoped, earlier, mismatched and downstream error codes cannot diagnose a Guard mismatch", () => {
  for (const logs of [
    undefined,
    failed(system, 101),
    failed(guard, 102),
    [...failed(guard, 101), ...failed(token, 101)],
    [
      `Program ${guard} invoke [1]`,
      ...failed(token, 101).map((line) => line.replace("[1]", "[2]")),
      `Program ${guard} failed: custom program error: 0x65`,
    ],
  ]) {
    const message = describeRecurringSimulationFailure(custom(101), logs);
    expect(message).toMatch(/instruction 6, program error 101/);
    expect(message).not.toMatch(/contract mismatch|Upgrade/);
  }
});

test("devnet failures distinguish SOL rent, test token funds and expired blockhashes", () => {
  for (const [error, logs] of [
    ["InsufficientFundsForFee", undefined],
    [{ InsufficientFundsForRent: { account_index: 1 } }, undefined],
    [custom(1), failed(system, 1)],
  ])
    expect(describeRecurringSimulationFailure(error, logs)).toMatch(
      /devnet SOL/,
    );
  expect(
    describeRecurringSimulationFailure(custom(1), failed(token, 1)),
  ).toMatch(/test KUSD balance and delegated allowance/);
  expect(describeRecurringSimulationFailure("BlockhashNotFound")).toMatch(
    /blockhash expired/,
  );
  const unknown = describeRecurringSimulationFailure(
    { endpoint: "provider-secret" },
    ["provider-secret"],
  );
  expect(unknown).not.toMatch(/provider-secret|liquidity/);
});
