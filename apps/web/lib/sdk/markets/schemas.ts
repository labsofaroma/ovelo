/**
 * zod schemas for untrusted provider payloads. Field semantics match the readers in parse.ts
 * (a wrong-typed field becomes "" / null / false, never an exception), so one malformed item
 * degrades to missing data instead of failing a whole catalog. Envelope checks (is `nodes` an
 * array, is pagination boolean) stay strict in the loaders, which fail closed.
 */
import { z } from "zod";
import {
  list,
  logo,
  nonnegative,
  number,
  positive,
  row,
  string,
  timestamp,
} from "./parse";

const str = z.unknown().transform(string).catch("");
const num = z.unknown().transform(number).catch(null);
const pos = z.unknown().transform(positive).catch(null);
const nonneg = z.unknown().transform(nonnegative).catch(null);
const https = z.unknown().transform(logo).catch(null);
const iso = z.unknown().transform(timestamp).catch(null);
/** Any non-object becomes {}, mirroring row(). */
/** A field whose raw value is compared by the caller (missing reads as undefined). */
const raw = z.unknown().optional();
const object = <T extends z.ZodRawShape>(shape: T) =>
  z.preprocess(
    (value) => (Array.isArray(value) ? {} : row(value)),
    z.object(shape),
  );

const deployment = object({ address: str, network: raw });

/** One xStocks catalog node with its Solana deployments. */
export const xstocksNodeSchema = object({
  symbol: str,
  name: str,
  logo: https,
  underlyingSymbol: str,
  isTradingHalted: z
    .unknown()
    .transform((value) => value === true)
    .catch(false),
  underlying: object({ symbol: str, type: raw }).catch({
    symbol: "",
    type: undefined,
  }),
  deployments: z.preprocess(list, z.array(deployment)),
});
export type XstocksNode = z.infer<typeof xstocksNodeSchema>;

/** One PreStocks `metrics` entry. */
export const prestocksMetricSchema = object({
  splMint: str,
  symbol: str,
  tokenPrice: pos,
  marketCapUSD: num,
});

/** Jupiter Tokens V2 search result item. */
export const jupiterTokenSchema = object({
  id: str,
  name: str,
  decimals: num,
  icon: https,
  usdPrice: pos,
  priceBlockId: nonneg,
  liquidity: nonneg,
  mcap: nonneg,
  updatedAt: iso,
  stats24h: object({
    priceChange: num,
    buyVolume: nonneg,
    sellVolume: nonneg,
  }),
});

/** Jupiter Price V3 entry for one mint. */
export const jupiterPriceSchema = object({
  usdPrice: pos,
  decimals: num,
  blockId: nonneg,
  priceChange24h: num,
  liquidity: nonneg,
  stockData: object({
    id: raw,
    price: pos,
    updatedAt: iso,
    mcap: nonneg,
  }),
});

/** A token decimals value is only accepted when it is a sane integer precision. */
export function precision(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 0 && value <= 18
    ? value
    : null;
}
