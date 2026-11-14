import { z } from "zod";

/**
 * Trade API contracts, shared by route handlers and the client (REWRITE-PLAN §2: one zod schema
 * for both sides). Amounts the user types are decimal strings converted with ON-CHAIN precision
 * on the server; everything signed or stored is raw integer units (AGENTS.md rule 5).
 */

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/** Funding tokens for v1 orders. Anything else is refused before routing. */
export const FUNDING_TOKENS = [
  { mint: USDC_MINT, symbol: "USDC", decimals: 6 },
  { mint: USDT_MINT, symbol: "USDT", decimals: 6 },
  { mint: SOL_MINT, symbol: "SOL", decimals: 9 },
] as const;
export const FUNDING_MINTS = FUNDING_TOKENS.map((t) => t.mint) as [
  string,
  ...string[],
];

export const base58Address = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 address");
export const decimalAmount = z
  .string()
  .regex(/^(0|[1-9]\d{0,11})(\.\d{1,18})?$/, "must be a positive decimal")
  .refine((v) => /[1-9]/.test(v), "must be greater than zero");

export const quoteRequestSchema = z
  .object({
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("spot"), mint: base58Address }).strict(),
      z
        .object({
          kind: z.literal("basket"),
          basketId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
        })
        .strict(),
    ]),
    inputMint: z.enum(FUNDING_MINTS),
    amount: decimalAmount,
    taker: base58Address,
    slippageBps: z.number().int().min(1).max(300).default(100),
    supportedTransactionVersions: z
      .array(z.union([z.literal(0), z.literal(1)]))
      .min(1)
      .max(2),
  })
  .strict();
export type QuoteRequestBody = z.infer<typeof quoteRequestSchema>;

/** Base64 transactions (a V1 transaction can reach 4096 bytes). */
const signedTransaction = z
  .string()
  .max(5464)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const submitRequestSchema = z
  .object({
    authorization: z.string().min(1).max(4096),
    signedTransactions: z.array(signedTransaction).min(1).max(5),
  })
  .strict();
export type SubmitRequestBody = z.infer<typeof submitRequestSchema>;

export const tradeIdSchema = z.uuid();

const raw = z.string().regex(/^\d{1,20}$/);
export const quoteLegSchema = z.object({
  mint: z.string(),
  symbol: z.string(),
  decimals: z.number().int().min(0).max(18),
  weightBps: z.number().int(),
  inputAmount: raw,
  outAmount: raw,
  minimumAmount: raw,
  priceImpactPct: z.string().nullable(),
  hops: z.number().int().nullable(),
  tx: z.number().int(),
});

export const quoteResponseSchema = z.object({
  requestId: z.string(),
  authorization: z.string(),
  transactions: z.array(z.string()).min(1).max(5),
  mode: z.enum(["single", "bundle"]),
  transactionVersion: z.union([z.literal(0), z.literal(1)]),
  expiresAt: z.number().int(),
  lastValidBlockHeight: z.number().int(),
  quote: z.object({
    kind: z.enum(["spot", "basket"]),
    basketId: z.string().nullable(),
    /** Creator baskets: the published version quoted. Null for stocks and curated baskets. */
    basketVersion: z.number().int().nullable().optional(),
    source: z.literal("Jupiter"),
    quotedAt: z.string(),
    inputMint: z.string(),
    inputSymbol: z.string(),
    inputDecimals: z.number().int(),
    inAmount: raw,
    maxDebit: raw,
    slippageBps: z.number().int(),
    legs: z.array(quoteLegSchema).min(1),
    fees: z.object({
      baseFeeLamports: raw,
      priorityFeeLamports: raw.nullable(),
      tipLamports: raw,
      platformFeeBps: z.literal(0),
    }),
    unitsConsumed: z.number().int(),
    atomicityWarning: z.string().nullable(),
  }),
  /** Phase A caps (W3); absent when a server predates them. */
  limits: z.lazy(() => quoteLimitsSchema).optional(),
});
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

/** Phase A caps (W3): the server's figures for this wallet, raw USDC units (6 decimals). */
export const quoteLimitsSchema = z.object({
  perTradeRaw: raw,
  dailyRaw: raw,
  usedTodayRaw: raw,
  remainingTodayRaw: raw,
  notionalRaw: raw,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type QuoteLimits = z.infer<typeof quoteLimitsSchema>;

export const tradeRecordSchema = z.object({
  id: z.string(),
  status: z.enum(["submitting", "pending", "confirmed", "failed", "unknown"]),
  mode: z.enum(["single", "bundle"]),
  signatures: z.array(z.string()),
  bundleId: z.string().nullable(),
  submittedAt: z.string(),
  updatedAt: z.string(),
  slot: z.number().int().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type TradeRecordView = z.infer<typeof tradeRecordSchema>;
