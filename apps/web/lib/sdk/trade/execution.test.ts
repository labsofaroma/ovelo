import { expect, test } from "vitest";
import { canApproveTrade, classifyTradeExecution } from "./execution";

test("missing confirmation is unknown rather than a false success or failure", () => {
  for (const payload of [
    null,
    {},
    new Error("network timeout"),
    { status: "Pending" },
    { status: "Success" },
    { status: "Success", signature: "invalid" },
  ]) {
    const result = classifyTradeExecution(payload);
    expect(result.status).toBe("Unknown");
    expect(result.error).toMatch(/may have completed/);
  }
  const signature = "2".repeat(88);
  expect(classifyTradeExecution({ status: "Success", signature }).status).toBe(
    "Success",
  );
  expect(
    classifyTradeExecution({ status: "Failed", error: "Transaction rejected" })
      .status,
  ).toBe("Failed");
});

test("a trade is approvable only by the quoted taker, before expiry, with a transaction", () => {
  const order = { taker: "wallet-a", transaction: "tx", expiresAt: 100 };
  expect(canApproveTrade(order, "wallet-a", 99)).toBe(true);
  expect(canApproveTrade(order, "wallet-a", 100)).toBe(false);
  expect(canApproveTrade(order, "wallet-b", 1)).toBe(false);
  expect(canApproveTrade(order, null, 1)).toBe(false);
  expect(canApproveTrade({ ...order, transaction: "" }, "wallet-a", 1)).toBe(
    false,
  );
});
