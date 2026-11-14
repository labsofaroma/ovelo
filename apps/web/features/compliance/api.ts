import { TradeApiError } from "../trade/api";
import {
  complianceStatusSchema,
  termsChallengeResponseSchema,
  type ComplianceStatus,
} from "./schema";

/** Client fetchers for /api/v1/compliance/* (zod-parsed; errors carry the server's `{ code, message }`). */
async function call<T>(
  url: string,
  parse: (body: unknown) => T,
  init?: RequestInit,
): Promise<T> {
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
  try {
    return parse(body);
  } catch {
    throw new TradeApiError(
      "INVALID_RESPONSE",
      "The server sent an unexpected answer.",
    );
  }
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const complianceApi = {
  status: (wallet: string | null): Promise<ComplianceStatus> =>
    call(
      `/api/v1/compliance/status${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ""}`,
      (b) => complianceStatusSchema.parse(b),
    ),
  challenge: (wallet: string) =>
    call(
      "/api/v1/compliance/terms/challenge",
      (b) => termsChallengeResponseSchema.parse(b),
      post({ wallet }),
    ),
  accept: (body: {
    wallet: string;
    nonce: string;
    signature: string;
    version: string;
  }) => call("/api/v1/compliance/terms/accept", (b) => b, post(body)),
};
