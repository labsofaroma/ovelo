import { z } from "zod";
import type { BasketDraftInput, CreatorProfile } from "./schema";

/**
 * Client fetchers for /api/v1/creators/* (M5b B2), zod-parsed both ways like features/trade/api.
 * Every mutation is JSON with `Content-Type: application/json`: middleware refuses anything else
 * with 415 on every non-GET /api request, DELETE included (M5b A4). A non-2xx answer becomes a
 * CreatorApiError carrying the server's user-safe `{ code, message }`, nothing else.
 */
export class CreatorApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = "CreatorApiError";
    this.code = code;
    this.status = status;
  }
}

const allocation = z.object({
  mint: z.string(),
  symbol: z.string(),
  weightBps: z.number().int(),
});
export const creatorBasketResponse = z.object({
  basket: z.object({
    id: z.string(),
    creatorWallet: z.string(),
    name: z.string(),
    ticker: z.string(),
    status: z.enum(["draft", "published", "archived"]),
    version: z.number().int(),
    publishedAt: z.string().nullable(),
    allocations: z.array(allocation),
  }),
});
export type CreatorBasketResponse = z.infer<typeof creatorBasketResponse>;

export const challengeResponse = z.object({
  nonce: z.string(),
  message: z.string(),
  basketId: z.string().nullable(),
  expiresAt: z.string(),
});
export type ChallengeResponse = z.infer<typeof challengeResponse>;

const redeemResponse = z.object({
  creator: z.object({ wallet: z.string(), displayName: z.string() }),
});
const statsResponse = z.object({
  wallet: z.string(),
  displayName: z.string(),
});

export type ChallengeRequest =
  | {
      purpose: "publish";
      wallet: string;
      basketId?: string;
      basket: BasketDraftInput;
    }
  | { purpose: "delete"; wallet: string; basketId: string }
  | { purpose: "redeem"; wallet: string; profile: CreatorProfile };

/** A request signed with a challenge: the nonce it consumed and the base64 signature. */
export type Signed = { wallet: string; nonce: string; signature: string };

export const JSON_HEADERS = { "Content-Type": "application/json" } as const;

async function call<S extends z.ZodType>(
  url: string,
  schema: S,
  init: RequestInit = {},
): Promise<z.output<S>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new CreatorApiError(
      "NETWORK",
      "The network request failed. Check your connection and try again.",
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body as { code?: unknown; message?: unknown } | null;
    throw new CreatorApiError(
      typeof error?.code === "string" ? error.code : "INTERNAL",
      typeof error?.message === "string"
        ? error.message
        : "Something went wrong.",
      response.status,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new CreatorApiError(
      "INVALID_RESPONSE",
      "The server sent an unexpected answer.",
      response.status,
    );
  return parsed.data;
}

const send = (method: "POST" | "DELETE", body: unknown): RequestInit => ({
  method,
  headers: JSON_HEADERS,
  body: JSON.stringify(body),
});

export const creatorApi = {
  challenge: (body: ChallengeRequest) =>
    call("/api/v1/creators/challenge", challengeResponse, send("POST", body)),
  redeem: (body: Signed & { code: string; profile: CreatorProfile }) =>
    call("/api/v1/creators/invites/redeem", redeemResponse, send("POST", body)),
  publish: (body: Signed & { basketId: string; basket: BasketDraftInput }) =>
    call(
      "/api/v1/creators/baskets",
      creatorBasketResponse,
      send("POST", { action: "publish", ...body }),
    ),
  archive: (basketId: string, body: Signed) =>
    call(
      `/api/v1/creators/baskets/${encodeURIComponent(basketId)}`,
      creatorBasketResponse,
      send("DELETE", body),
    ),
  /** Is this wallet a creator? 404 means "not yet": it needs an invite. */
  async isCreator(wallet: string): Promise<boolean> {
    try {
      await call(
        `/api/v1/creators/${encodeURIComponent(wallet)}/stats`,
        statsResponse,
      );
      return true;
    } catch (error) {
      if (
        error instanceof CreatorApiError &&
        (error.status === 404 || error.status === 403)
      )
        return false;
      throw error;
    }
  },
};
export type CreatorApi = typeof creatorApi;
