import {
  DEVNET_TEST_PERIOD_SECONDS,
  MAX_OUTPUTS,
  MAX_SCHEDULE_SECONDS,
  PERIOD_PRESETS,
  type PrepareCreateRequest,
} from "./schema";
import { parseDecimalToRaw } from "./amounts";

/** Pure wizard rules (mirror the server's validation so errors show before any request). */

export type WizardAsset = {
  mint: string;
  symbol: string;
  name: string;
  enabled: boolean;
};
export type WizardBasket = {
  id: string;
  name: string;
  kind: "curated" | "creator";
  available: boolean;
  missing: string[];
  outputs: { mint: string; symbol: string; weightBps: number }[];
};

export type WizardState = {
  mode: "basket" | "assets";
  basketId: string | null;
  /** Percent text per mint, e.g. { mint: "50" } (two decimals at most). */
  weights: Record<string, string>;
  amount: string;
  periodSeconds: number;
  periods: string;
};

export type WizardField = "selection" | "weights" | "amount" | "periods";

export const TEST_PERIOD_SECONDS = 15;

export function periodChoices(
  cluster: "devnet" | "localnet",
  testPeriods = false,
): { seconds: number; label: string }[] {
  const base = [
    { seconds: PERIOD_PRESETS.daily, label: "Every day" },
    { seconds: PERIOD_PRESETS.weekly, label: "Every week" },
    { seconds: PERIOD_PRESETS.every30Days, label: "Every 30 days" },
  ];
  return cluster === "localnet"
    ? [
        {
          seconds: TEST_PERIOD_SECONDS,
          label: "Every 15 seconds (local test)",
        },
        ...base,
      ]
    : testPeriods
      ? [
          {
            seconds: DEVNET_TEST_PERIOD_SECONDS,
            label: "Every 15 minutes (devnet test build)",
          },
          ...base,
        ]
      : base;
}

/** "33.34" → 3334 bps; null if not a percentage with at most two decimals. */
export function percentToBps(text: string): number | null {
  const raw = parseDecimalToRaw(text, 2);
  if (raw === null || raw > 10_000n) return null;
  return Number(raw);
}

export type WizardResult =
  | { ok: true; request: PrepareCreateRequest }
  | { ok: false; errors: Partial<Record<WizardField, string>> };

export function buildCreateRequest(
  owner: string,
  state: WizardState,
  options: {
    decimals: number;
    maxInstallmentRaw: bigint;
    baskets: WizardBasket[];
  },
): WizardResult {
  const errors: Partial<Record<WizardField, string>> = {};
  let selection: PrepareCreateRequest["selection"] | null = null;
  if (state.mode === "basket") {
    const basket = options.baskets.find((b) => b.id === state.basketId);
    if (!basket) errors.selection = "Choose a basket.";
    else if (!basket.available)
      errors.selection = `Not on devnet: ${basket.missing.join(", ")}.`;
    else selection = { kind: "basket", basketId: basket.id };
  } else {
    const outputs = Object.entries(state.weights)
      .filter(([, text]) => text.trim() !== "")
      .map(([mint, text]) => ({ mint, weightBps: percentToBps(text) }));
    if (outputs.length === 0) errors.selection = "Choose at least one asset.";
    else if (outputs.length > MAX_OUTPUTS)
      errors.selection = `Choose at most ${MAX_OUTPUTS} assets.`;
    else if (outputs.some((o) => o.weightBps === null || o.weightBps <= 0))
      errors.weights =
        "Each weight must be a positive percentage with at most two decimals.";
    else if (outputs.reduce((sum, o) => sum + (o.weightBps ?? 0), 0) !== 10_000)
      errors.weights = "Weights must add up to exactly 100%.";
    else
      selection = {
        kind: "assets",
        outputs: outputs.map((o) => ({
          mint: o.mint,
          weightBps: o.weightBps!,
        })),
      };
  }
  const amount = parseDecimalToRaw(state.amount, options.decimals);
  if (amount === null || amount <= 0n)
    errors.amount = "Enter a positive amount.";
  else if (amount > options.maxInstallmentRaw)
    errors.amount = "That is above the devnet limit per installment.";
  const periods = /^\d{1,3}$/.test(state.periods.trim())
    ? Number(state.periods)
    : NaN;
  if (!Number.isInteger(periods) || periods < 1)
    errors.periods = "Enter a whole number of installments.";
  else if (periods * state.periodSeconds > MAX_SCHEDULE_SECONDS)
    errors.periods = "The whole schedule must fit in 366 days.";
  if (Object.keys(errors).length || !selection || amount === null)
    return { ok: false, errors };
  return {
    ok: true,
    request: {
      owner,
      fundingAmount: amount.toString(),
      periodSeconds: state.periodSeconds,
      periods,
      selection,
    },
  };
}
