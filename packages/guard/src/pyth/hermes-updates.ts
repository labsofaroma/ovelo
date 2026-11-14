/**
 * Hermes client for the binary price updates the keeper posts on-chain
 * (`GET /v2/updates/price/latest?ids[]=…&encoding=base64&parsed=true`). Validated by hand; any
 * unexpected shape is a `malformed` error. Staleness is the caller's decision, so every feed
 * carries its publish time.
 */
import { fromBase64 } from "./bytes";

export type HermesErrorKind =
  "unauthorized" | "unreachable" | "malformed" | "http";

export class HermesError extends Error {
  constructor(
    readonly kind: HermesErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HermesError";
  }
}

export type HermesFeedPrice = {
  /** Lowercase hex with 0x. */
  id: string;
  price: bigint;
  conf: bigint;
  expo: number;
  /** Unix seconds. */
  publishTime: bigint;
};

export type HermesLatestUpdates = {
  /** Accumulator updates (`binary.data`), each covering one or more of the feeds. */
  updates: Uint8Array[];
  feeds: HermesFeedPrice[];
  /** Milliseconds since the epoch, when the response arrived. */
  fetchedAt: number;
};

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const FEED_ID = /^(0x)?[0-9a-fA-F]{64}$/;
const INTEGER = /^-?\d+$/;

export const normalizeFeedId = (id: string): string => {
  if (!FEED_ID.test(id)) throw new Error(`Invalid Pyth feed id: ${id}`);
  return `0x${id.replace(/^0x/, "").toLowerCase()}`;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function malformed(detail: string): never {
  throw new HermesError("malformed", `Hermes response is malformed: ${detail}`);
}

function parseFeed(value: unknown): HermesFeedPrice {
  if (!isRecord(value) || typeof value.id !== "string") malformed("feed id");
  const price = value.price;
  if (!isRecord(price)) malformed("price");
  const { price: p, conf, expo, publish_time: time } = price;
  if (
    typeof p !== "string" ||
    !INTEGER.test(p) ||
    typeof conf !== "string" ||
    !/^\d+$/.test(conf) ||
    typeof expo !== "number" ||
    !Number.isInteger(expo) ||
    typeof time !== "number" ||
    !Number.isSafeInteger(time) ||
    time <= 0
  )
    malformed("price fields");
  if (!FEED_ID.test(value.id)) malformed("feed id");
  return {
    id: normalizeFeedId(value.id),
    price: BigInt(p),
    conf: BigInt(conf),
    expo,
    publishTime: BigInt(time),
  };
}

export class HermesUpdatesClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly options: {
      apiKey?: string;
      fetch?: FetchLike;
      timeoutMs?: number;
      now?: () => number;
    } = {},
  ) {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("Hermes URL must be http(s).");
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async latestUpdates(
    feedIds: readonly string[],
  ): Promise<HermesLatestUpdates> {
    if (feedIds.length === 0) throw new Error("Ask for at least one feed.");
    const ids = [...new Set(feedIds.map(normalizeFeedId))];
    const query = ids.map((id) => `ids[]=${id}`).join("&");
    const url = `${this.baseUrl}/v2/updates/price/latest?${query}&encoding=base64&parsed=true`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.apiKey)
      headers.Authorization = `Bearer ${this.options.apiKey}`;
    const fetcher: FetchLike =
      this.options.fetch ??
      ((input, init) => fetch(input, init) as ReturnType<FetchLike>);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await fetcher(url, {
        headers,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      throw new HermesError(
        "unreachable",
        "Hermes is unreachable or timed out.",
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new HermesError(
        "unauthorized",
        "Hermes refused the API key.",
        response.status,
      );
    if (!response.ok)
      throw new HermesError(
        "http",
        `Hermes answered ${response.status}.`,
        response.status,
      );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      malformed("not JSON");
    }
    if (!isRecord(body) || !isRecord(body.binary)) malformed("binary");
    const { encoding, data } = body.binary;
    if (encoding !== "base64" || !Array.isArray(data) || data.length === 0)
      malformed("binary data");
    const updates = data.map((item) => {
      if (typeof item !== "string") malformed("binary item");
      try {
        return fromBase64(item);
      } catch {
        return malformed("binary base64");
      }
    });
    if (!Array.isArray(body.parsed)) malformed("parsed");
    const feeds = body.parsed.map(parseFeed);
    const missing = ids.filter((id) => !feeds.some((f) => f.id === id));
    if (missing.length) malformed(`missing feeds ${missing.join(", ")}`);
    return {
      updates,
      feeds,
      fetchedAt: (this.options.now ?? Date.now)(),
    };
  }
}
