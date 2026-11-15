import { AppError } from "./errors";

/**
 * M9 emergency stop (replaces the old "v1 flag off" stop, BETA-RUNBOOK §6).
 * OVELO_TRADING=off refuses every mainnet trading entry point (quote, submit, Action POST) with
 * 503 TRADING_UNAVAILABLE, in middleware AND in each route (so a matcher change cannot open it).
 * Reads, receipts (the Action confirm callback, GET /api/v1/trade/:id) and plan closes stay open.
 * Any value other than "off" is the default "on"; the boot schema refuses anything but on|off.
 */
export function tradingOff(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.OVELO_TRADING?.trim().toLowerCase() === "off";
}

export function assertTradingOpen(
  env?: Readonly<Record<string, string | undefined>>,
): void {
  if (tradingOff(env))
    throw new AppError("TRADING_UNAVAILABLE", {
      publicMessage:
        "Trading is paused. Nothing was quoted or sent; try again later.",
      detail: "OVELO_TRADING=off",
    });
}
