import type { z } from "zod";
import { pricesResponseSchema } from "./prices-schema";
import {
  quoteResponseSchema,
  tradeRecordSchema,
  type QuoteRequestBody,
  type SubmitRequestBody,
} from "./schema";
import type { FlowError } from "./flow";

/**
 * Client fetchers for /api/v1/trade/* (zod-parsed both ways, REWRITE-PLAN §2). A non-2xx answer
 * becomes a FlowError carrying the server's user-safe `{ code, message }`, nothing else.
 */
export class TradeApiError extends Error implements FlowError {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function call<S extends z.ZodType>(
  url: string,
  schema: S,
  init?: RequestInit,
): Promise<z.output<S>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store" });
  } catch {
    throw new TradeApiError(
      "NETWORK",
      "The network request failed. Check your connection and try again.",
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as { code?: unknown; message?: unknown } | null;
    throw new TradeApiError(
      typeof error?.code === "string" ? error.code : "INTERNAL",
      typeof error?.message === "string"
        ? error.message
        : "Something went wrong.",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new TradeApiError(
      "INVALID_RESPONSE",
      "The server sent an unexpected answer.",
    );
  return parsed.data;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const tradeApi = {
  quote: (body: QuoteRequestBody) =>
    call("/api/v1/trade/quote", quoteResponseSchema, json(body)),
  submit: (body: SubmitRequestBody) =>
    call("/api/v1/trade/submit", tradeRecordSchema, json(body)),
  status: (id: string) =>
    call(`/api/v1/trade/${encodeURIComponent(id)}`, tradeRecordSchema),
  prices: (mints: readonly string[]) =>
    call(`/api/v1/prices?mints=${mints.join(",")}`, pricesResponseSchema),
};
