import "server-only";
import type { Address } from "@solana/kit";
import {
  legAmounts,
  MAX_OUTPUTS,
  TOTAL_WEIGHT_BPS,
  type Config,
  type OutputArgs,
} from "@aroma/guard";
import { AppError } from "@/server/errors";
import {
  DEVNET_TEST_PERIOD_SECONDS,
  MAX_SCHEDULE_SECONDS,
  MIN_TEST_PERIOD_SECONDS,
  PERIOD_PRESETS,
  type InvestClusterName,
  type PlanSelection,
} from "../schema";
import type { BasketOption, CatalogAsset } from "./catalog";

/**
 * Server-side mirror of `create_plan`'s checks (aroma-guard-v1.md), so a refusal is explained in
 * words before anything is signed. The program re-checks everything; simulation is the backstop.
 */

/** Per-output slippage the plan records; never above the config cap. */
export const DEFAULT_SLIPPAGE_BPS = 100;
const PRESETS = new Set<number>(Object.values(PERIOD_PRESETS));

const refuse = (publicMessage: string, detail: string) =>
  new AppError("VALIDATION_FAILED", { publicMessage, detail });

export type ResolvedOutputs = { outputs: OutputArgs[]; symbols: string[] };

export function resolveOutputs(
  selection: PlanSelection,
  catalog: readonly CatalogAsset[],
  baskets: readonly BasketOption[],
  config: Pick<Config, "maxSlippageBps">,
): ResolvedOutputs {
  const slippage = Math.min(DEFAULT_SLIPPAGE_BPS, config.maxSlippageBps);
  let chosen: { mint: Address; weightBps: number }[];
  if (selection.kind === "basket") {
    const basket = baskets.find((b) => b.id === selection.basketId);
    if (!basket) throw new AppError("NOT_FOUND", { detail: "unknown basket" });
    if (!basket.available)
      throw refuse(
        `This basket is not available on devnet: ${basket.missing.join(", ")} ${basket.missing.length === 1 ? "is" : "are"} not registered there. Nothing was created.`,
        `basket missing ${basket.missing.join(",")}`,
      );
    chosen = basket.outputs;
  } else {
    chosen = selection.outputs.map((o) => ({
      mint: o.mint as Address,
      weightBps: o.weightBps,
    }));
  }
  const byMint = new Map(catalog.map((a) => [a.mint, a]));
  const symbols: string[] = [];
  for (const output of chosen) {
    const asset = byMint.get(output.mint);
    if (!asset)
      throw refuse(
        "One of the assets is not registered on devnet.",
        `unregistered ${output.mint}`,
      );
    if (!asset.enabled)
      throw refuse(
        `${asset.symbol} is paused on devnet right now.`,
        `disabled ${output.mint}`,
      );
    symbols.push(asset.symbol);
  }
  return {
    outputs: chosen.map((o) => ({
      mint: o.mint,
      weightBps: o.weightBps,
      maxSlippageBps: slippage,
    })),
    symbols,
  };
}

export function assertPlanTerms(input: {
  cluster: InvestClusterName;
  /** Devnet test builds only: also accept DEVNET_TEST_PERIOD_SECONDS. */
  testPeriods?: boolean;
  config: Pick<
    Config,
    "paused" | "allowedFundingMints" | "maxInstallmentAmount"
  >;
  fundingMint: Address;
  fundingAmount: bigint;
  periodSeconds: number;
  periods: number;
  outputs: readonly OutputArgs[];
}): void {
  const { config } = input;
  if (config.paused)
    throw new AppError("INVEST_UNAVAILABLE", {
      publicMessage:
        "Recurring investing is paused on devnet right now. Nothing was created.",
      detail: "config paused",
    });
  if (!config.allowedFundingMints.includes(input.fundingMint))
    throw new AppError("INVEST_UNAVAILABLE", {
      detail: "funding mint not allow-listed",
    });
  if (input.fundingAmount > config.maxInstallmentAmount)
    throw refuse(
      "That installment is above the devnet limit per installment.",
      "above launch cap",
    );
  if (
    input.cluster === "devnet" &&
    !PRESETS.has(input.periodSeconds) &&
    !(input.testPeriods && input.periodSeconds === DEVNET_TEST_PERIOD_SECONDS)
  )
    throw refuse(
      "Choose every day, every week or every 30 days.",
      "period not a preset",
    );
  if (input.periodSeconds < MIN_TEST_PERIOD_SECONDS)
    throw refuse("That period is too short.", "period below minimum");
  if (
    BigInt(input.periods) * BigInt(input.periodSeconds) >
    BigInt(MAX_SCHEDULE_SECONDS)
  )
    throw refuse(
      "The whole schedule must fit in 366 days.",
      "schedule too long",
    );
  const { outputs } = input;
  if (outputs.length < 1 || outputs.length > MAX_OUTPUTS)
    throw refuse(`Choose 1 to ${MAX_OUTPUTS} assets.`, "output count");
  const mints = new Set(outputs.map((o) => o.mint));
  if (mints.size !== outputs.length || mints.has(input.fundingMint))
    throw refuse(
      "Each asset can appear once, and none can be the funding token.",
      "duplicate output",
    );
  if (
    outputs.some((o) => !Number.isInteger(o.weightBps) || o.weightBps <= 0) ||
    outputs.reduce((sum, o) => sum + o.weightBps, 0) !== TOTAL_WEIGHT_BPS
  )
    throw refuse("Weights must be positive and add up to 100%.", "weights");
  if (
    legAmounts(
      input.fundingAmount,
      outputs.map((o) => o.weightBps),
    ).some((a) => a === 0n)
  )
    throw refuse(
      "The installment is too small to give every asset a share. Raise the amount or use fewer assets.",
      "zero leg",
    );
}
