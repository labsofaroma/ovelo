import "server-only";
import { getMarkets } from "@/features/markets/server";
import { AppError, mapError } from "@/server/errors";
import { tradeEvent } from "@/server/telemetry";
import type { QuoteRequestBody, SubmitRequestBody } from "../schema";
import { quoteDeps, submitDeps } from "./deps";
import { prepareQuote, type PreparedQuote } from "./quote";
import type { TradeRecord } from "./store";
import { getTrade, submitTrade } from "./submit";
import { resolveTarget } from "./target";

/**
 * Services behind the thin /api/v1/trade handlers: parse(schema) → service → typed result →
 * mapError (§5.4). Each stage leaves a structured, redacted log line and a Sentry breadcrumb.
 */

export async function quoteTrade(
  body: QuoteRequestBody,
): Promise<PreparedQuote> {
  const markets = await getMarkets();
  if (markets.state !== "ok")
    throw new AppError("UPSTREAM_UNAVAILABLE", {
      detail: "issuer catalog unavailable for trade",
    });
  const target = resolveTarget(body, markets.data);
  tradeEvent("quote.requested", {
    kind: target.kind,
    legs: target.legs.length,
    taker: body.taker,
  });
  try {
    const prepared = await prepareQuote({ ...body, target }, quoteDeps());
    tradeEvent("quote.prepared", {
      requestId: prepared.requestId,
      mode: prepared.mode,
      transactions: prepared.transactions.length,
      version: prepared.transactionVersion,
      unitsConsumed: prepared.quote.unitsConsumed,
    });
    return prepared;
  } catch (error) {
    tradeEvent("quote.refused", { code: mapError(error).body.code }, "warning");
    throw error;
  }
}

export async function submitSignedTrade(
  body: SubmitRequestBody,
): Promise<TradeRecord> {
  try {
    const record = await submitTrade(body, submitDeps());
    tradeEvent(
      "submit.result",
      {
        requestId: record.id,
        status: record.status,
        mode: record.mode,
        signatures: record.signatures,
      },
      record.status === "failed" ? "warning" : "info",
    );
    return record;
  } catch (error) {
    tradeEvent(
      "submit.refused",
      { code: mapError(error).body.code },
      "warning",
    );
    throw error;
  }
}

export async function tradeStatus(id: string): Promise<TradeRecord> {
  const record = await getTrade(id, submitDeps());
  if (!record) throw new AppError("NOT_FOUND", { detail: "unknown trade id" });
  return record;
}

/** What a client may see of a trade record (no receipt internals). */
export function publicRecord(record: TradeRecord) {
  return {
    id: record.id,
    status: record.status,
    mode: record.mode,
    signatures: record.signatures,
    bundleId: record.bundleId,
    submittedAt: record.submittedAt,
    updatedAt: record.updatedAt,
    slot: record.slot,
    error: record.error,
  };
}
