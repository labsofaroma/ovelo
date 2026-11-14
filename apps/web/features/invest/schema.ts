import { z } from "zod";

/**
 * Request and response schemas for `/api/v1/plans` and `/api/v1/faucet` (M7 B3/B6). Shared by the
 * route handlers and the UI, so nothing here imports server code. Amounts are raw integer units
 * as decimal strings (AGENTS.md rule 5); times are unix seconds as decimal strings.
 */

const U64_MAX = 2n ** 64n - 1n;
export const base58Address = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 address");
/** A positive raw amount that fits in a u64. */
export const rawPositive = z
  .string()
  .regex(/^[1-9]\d{0,19}$/, "must be a positive integer")
  .refine((v) => /^\d+$/.test(v) && BigInt(v) <= U64_MAX, "exceeds u64");
const rawAmount = z.string().regex(/^(0|[1-9]\d{0,19})$/);
const unixSeconds = z.string().regex(/^\d{1,12}$/);

/**
 * Period presets. Devnet uses real cadences; "every 30 days" is never called monthly
 * (PRODUCT.md). A localnet test build may also use short periods (the program's devnet build
 * allows ≥ 10 s) so a local validator runs several periods.
 */
export const PERIOD_PRESETS = {
  daily: 86_400,
  weekly: 604_800,
  every30Days: 2_592_000,
} as const;
export const PERIOD_LABEL: Record<number, string> = {
  86_400: "every day",
  604_800: "every week",
  2_592_000: "every 30 days",
};
export const MIN_TEST_PERIOD_SECONDS = 10;
/** The program's limit: the whole schedule fits in 366 days. */
export const MAX_SCHEDULE_SECONDS = 366 * 86_400;
export const MAX_OUTPUTS = 20;

export const outputSchema = z
  .object({
    mint: base58Address,
    weightBps: z.number().int().min(1).max(10_000),
  })
  .strict();

export const selectionSchema = z.discriminatedUnion("kind", [
  /** A curated basket slug or a published creator basket id. */
  z
    .object({ kind: z.literal("basket"), basketId: z.string().min(1).max(64) })
    .strict(),
  /** One or more registered devnet assets with explicit weights. */
  z
    .object({
      kind: z.literal("assets"),
      outputs: z.array(outputSchema).min(1).max(MAX_OUTPUTS),
    })
    .strict(),
]);
export type PlanSelection = z.infer<typeof selectionSchema>;

export const prepareCreateSchema = z
  .object({
    owner: base58Address,
    /** Funding per installment, raw units of the funding mint. */
    fundingAmount: rawPositive,
    periodSeconds: z
      .number()
      .int()
      .min(MIN_TEST_PERIOD_SECONDS)
      .max(MAX_SCHEDULE_SECONDS),
    periods: z.number().int().min(1).max(366),
    selection: selectionSchema,
  })
  .strict()
  .refine((v) => v.periods * v.periodSeconds <= MAX_SCHEDULE_SECONDS, {
    message: "the schedule must fit in 366 days",
    path: ["periods"],
  });
export type PrepareCreateRequest = z.infer<typeof prepareCreateSchema>;

export const prepareCloseSchema = z.object({ owner: base58Address }).strict();

export const submitSchema = z
  .object({
    authorization: z.string().min(16).max(4_096),
    /** The wallet-signed transaction, base64 (one transaction: create+approve or close+revoke). */
    transaction: z.string().min(16).max(8_192),
  })
  .strict();
export type SubmitRequest = z.infer<typeof submitSchema>;

export const faucetSchema = z
  .object({
    wallet: base58Address,
    /** Cloudflare Turnstile response token. */
    turnstileToken: z.string().min(1).max(2_048),
    /** Unix seconds the wallet signed `faucetMessage` at (must be within 5 minutes). */
    issuedAt: unixSeconds,
    /** Base64 Ed25519 signature by `wallet` over `faucetMessage(...)` (AGENTS.md rule 2). */
    signature: z
      .string()
      .regex(/^[A-Za-z0-9+/]{86}==$/, "must be a base64 64-byte signature"),
  })
  .strict();
export type FaucetRequest = z.infer<typeof faucetSchema>;

/**
 * The exact text a wallet signs to claim test tokens. Built the same way in the browser and on
 * the server; it names the cluster and says the tokens have no value.
 */
export function faucetMessage(
  wallet: string,
  issuedAt: string,
  cluster: InvestClusterName,
): string {
  return [
    "Aroma devnet faucet",
    `Wallet: ${wallet}`,
    `Cluster: ${cluster}`,
    `Issued at: ${issuedAt}`,
    "Test tokens only, no real value.",
  ].join("\n");
}

/* ------------------------------------------------------------------------- responses */

export type InvestClusterName = "devnet" | "localnet";

export type ApprovalSummary = {
  /** The funding taken per installment (raw). */
  installmentRaw: string;
  /** The delegation's per-period allowance: `(1 + window) × installment` (raw). */
  allowancePerPeriodRaw: string;
  catchUpWindowPeriods: number;
  /** When the delegation stops allowing pulls (unix seconds). */
  delegationExpiresAt: string;
  /** Plain words shown before signing. */
  text: string;
};

export type PlanSummary = {
  cluster: InvestClusterName;
  label: string;
  title: string;
  lines: string[];
  approval: ApprovalSummary;
  risk: string;
};

export type PreparedTransaction = {
  /** Unsigned, base64 wire transaction for the wallet to sign. */
  transaction: string;
  authorization: string;
  plan: string;
  expiresAt: number;
  summary: PlanSummary;
  simulation: { unitsConsumed: string | null };
};

export type LegRecord = {
  leg: number;
  mint: string;
  symbol: string | null;
  amountIn: string;
  amountOut: string;
  minOut: string;
  oraclePrice: string;
  oracleExpo: number;
  oraclePublishTime: string;
};

export type ExecutionRecord = {
  signature: string;
  blockTime: string | null;
  periodComplete: boolean;
  legs: LegRecord[];
};

export type TimelineEntryView = {
  period: number;
  scheduledAt: string;
  status:
    "executed" | "skipped" | "pending" | "due" | "in_progress" | "unindexed";
  recordedOnChain: boolean;
  executions: ExecutionRecord[];
};

export type PlanView = {
  pda: string;
  owner: string;
  status: "active" | "paused" | "completed";
  fundingMint: string;
  fundingSymbol: string;
  fundingDecimals: number;
  installmentRaw: string;
  periodSeconds: string;
  periods: number;
  startsAt: string;
  expiresAt: string;
  executedPeriods: number;
  skippedPeriods: number;
  catchUpWindowPeriods: number;
  outputs: { mint: string; symbol: string | null; weightBps: number }[];
  timeline: TimelineEntryView[];
  /** False while some settled periods are not indexed yet (reconciliation pending). */
  timelineComplete: boolean;
};

export type PlansResponse = {
  cluster: InvestClusterName;
  available: boolean;
  plans: PlanView[];
  /** Chain time the plans were read at (unix seconds). */
  asOf: string;
  source: string;
};

export type SubmitResponse = {
  signature: string;
  plan: string;
  kind: "plan_create" | "plan_close";
  status: "confirmed";
  slot: string | null;
  /** Owner-facing result lines (e.g. rent returned, delegation revoked). */
  result: string[];
};

export type FaucetResponse = {
  wallet: string;
  testUsdRaw: string;
  lamports: string;
  signature: string;
  cluster: InvestClusterName;
};

export { rawAmount, unixSeconds };
