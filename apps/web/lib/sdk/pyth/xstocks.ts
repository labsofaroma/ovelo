/** Issuer oracle metadata adapter. */

import type { MarketAsset } from "../markets";
import { XSTOCKS_PYTH_FEEDS } from "./feeds";
import type { XStocksOracleInfo } from "./types";

/**
 * Read an explicitly configured issuer oracle endpoint. No default endpoint has
 * been verified for this legacy adapter; absence/failure returns no observations.
 * Static Pyth identities must not masquerade as a live issuer oracle registry.
 */
export async function fetchXStocksOracles(
  customUrl?: string,
): Promise<XStocksOracleInfo[]> {
  if (!customUrl) return [];
  try {
    const url = new URL(customUrl);
    if (url.protocol !== "https:" || url.username || url.password) return [];
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    const records = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && "oracles" in payload
        ? payload.oracles
        : null;
    if (!Array.isArray(records)) return [];
    return records.filter((item): item is XStocksOracleInfo =>
      Boolean(
        item &&
        typeof item === "object" &&
        typeof item.symbol === "string" &&
        (item.feedId === undefined ||
          /^(0x)?[a-fA-F0-9]{64}$/.test(item.feedId)) &&
        (item.price === undefined ||
          (typeof item.price === "number" &&
            Number.isFinite(item.price) &&
            item.price > 0)),
      ),
    );
  } catch {
    return [];
  }
}
