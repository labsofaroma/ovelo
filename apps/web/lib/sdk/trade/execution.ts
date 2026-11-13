import {
  UNKNOWN_TRADE_MESSAGE,
  type MainnetTradeOrder,
  type MainnetTradeResult,
} from "./types";

/** A transport error or malformed provider response cannot establish onchain failure. */
export function classifyTradeExecution(value: unknown): MainnetTradeResult {
  if (!value || typeof value !== "object")
    return { status: "Unknown", error: UNKNOWN_TRADE_MESSAGE };
  const result = value as Record<string, unknown>;
  const signature =
    typeof result.signature === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(result.signature)
      ? result.signature
      : undefined;
  if (result.status === "Success" && signature)
    return {
      status: "Success",
      signature,
      totalInputAmount:
        typeof result.totalInputAmount === "string"
          ? result.totalInputAmount
          : undefined,
      totalOutputAmount:
        typeof result.totalOutputAmount === "string"
          ? result.totalOutputAmount
          : undefined,
    };
  if (result.status === "Failed")
    return {
      status: "Failed",
      signature,
      error:
        typeof result.error === "string"
          ? result.error
          : "The provider reported that the swap failed.",
    };
  return { status: "Unknown", signature, error: UNKNOWN_TRADE_MESSAGE };
}

export function canApproveTrade(
  order: Pick<MainnetTradeOrder, "taker" | "transaction" | "expiresAt">,
  walletAddress: string | null,
  now = Date.now(),
): boolean {
  return Boolean(
    walletAddress &&
    order.taker === walletAddress &&
    order.transaction &&
    order.expiresAt > now,
  );
}
