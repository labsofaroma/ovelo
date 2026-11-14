import "server-only";
import { FUNDING_TOKENS } from "@/features/trade/schema";
import { toTokenAmount } from "@/lib/sdk/core/amounts";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { capsConfig, usd, utcDay, type CapsConfig } from "../config";
import type { CapsDeps } from "./deps";
import { usdcNotional } from "./notional";
import {
  DailyCapExceeded,
  reserve,
  settle,
  staleReservations,
  usedOn,
} from "./store";

/**
 * W3: a maximum USDC notional per trade and per wallet per UTC day, enforced on the server at
 * quote (refuse early) and at submit (re-check, then an atomic reservation tied to the trade
 * authorization). The cap counts the WALLET, never the IP. Fails closed: no configuration, no
 * database or no price means nothing is quoted or sent.
 */
export type Limits = {
  perTradeRaw: string;
  dailyRaw: string;
  usedTodayRaw: string;
  remainingTodayRaw: string;
  notionalRaw: string;
  day: string;
};

/** Resolve after the quote expires plus a margin past any blockhash lifetime (~60–90 s). */
export const RESOLVE_MARGIN_MS = 5 * 60_000;

function config(deps: CapsDeps): CapsConfig {
  try {
    return capsConfig(deps.env());
  } catch (cause) {
    throw new AppError("TRADE_CAP_UNAVAILABLE", {
      detail: "trade caps not configured",
      cause,
    });
  }
}

const unavailable = (cause: unknown) =>
  new AppError("TRADE_CAP_UNAVAILABLE", { detail: "caps store failed", cause });

/** Settle this wallet's stale reservations from the chain (expired unconfirmed → released). */
async function resolveStale(deps: CapsDeps, wallet: string): Promise<void> {
  const stale = await staleReservations(deps.db(), wallet, deps.now());
  for (const reservation of stale) {
    const outcome = await deps.outcome(reservation.requestId);
    if (outcome === "open") continue;
    await settle(
      deps.db(),
      reservation.requestId,
      outcome === "confirmed" ? "confirmed" : "released",
    );
  }
}

function overTrade(cfg: CapsConfig): AppError {
  return new AppError("TRADE_CAP_EXCEEDED", {
    publicMessage: `During the private beta each trade is limited to ${usd(cfg.perTrade)}. Lower the amount. Nothing was quoted or sent.`,
    detail: "per-trade cap",
  });
}

function overDay(cfg: CapsConfig, used: bigint): AppError {
  const left = used >= cfg.daily ? 0n : cfg.daily - used;
  return new AppError("DAILY_CAP_EXCEEDED", {
    publicMessage: `During the private beta each wallet can buy up to ${usd(cfg.daily)} per UTC day; ${usd(left)} is left today. Nothing was quoted or sent.`,
    detail: "daily cap",
  });
}

function limits(
  cfg: CapsConfig,
  used: bigint,
  notional: bigint,
  day: string,
): Limits {
  const remaining = used >= cfg.daily ? 0n : cfg.daily - used;
  return {
    perTradeRaw: cfg.perTrade.toString(),
    dailyRaw: cfg.daily.toString(),
    usedTodayRaw: used.toString(),
    remainingTodayRaw: remaining.toString(),
    notionalRaw: notional.toString(),
    day,
  };
}

/**
 * The raw amount the user ASKED for, before any route is built (a cheap pre-check, so an order
 * over the cap never reaches Jupiter). Null when it cannot be read; the post-quote check on the
 * authorized maximum debit is the one that counts.
 */
export function requestedRaw(inputMint: string, amount: string): bigint | null {
  const token = FUNDING_TOKENS.find((t) => t.mint === inputMint);
  if (!token) return null;
  try {
    return BigInt(toTokenAmount(amount, token.decimals));
  } catch {
    return null;
  }
}

/** At quote: refuse above the per-trade cap, or when today's used amount plus this passes the day. */
export async function checkQuoteCaps(
  deps: CapsDeps,
  input: { wallet: string; inputMint: string; amountRaw: bigint },
): Promise<Limits> {
  const cfg = config(deps);
  const notional = await usdcNotional(
    input.inputMint,
    input.amountRaw,
    deps.price,
  );
  if (notional > cfg.perTrade) throw overTrade(cfg);
  const day = utcDay(deps.now());
  let used: bigint;
  try {
    await resolveStale(deps, input.wallet);
    used = await usedOn(deps.db(), input.wallet, day);
  } catch (cause) {
    throw unavailable(cause);
  }
  if (used + notional > cfg.daily) throw overDay(cfg, used);
  return limits(cfg, used, notional, day);
}

/**
 * At submit: re-check the per-trade cap, then reserve atomically for this authorization's
 * request id. A replay of the same authorization reserves nothing more.
 */
export async function reserveForSubmit(
  deps: CapsDeps,
  input: {
    requestId: string;
    wallet: string;
    inputMint: string;
    amountRaw: bigint;
    expiresAt: number;
  },
): Promise<"reserved" | "replay"> {
  const cfg = config(deps);
  const notional = await usdcNotional(
    input.inputMint,
    input.amountRaw,
    deps.price,
  );
  if (notional > cfg.perTrade) throw overTrade(cfg);
  try {
    await resolveStale(deps, input.wallet);
    return await reserve(deps.db(), {
      requestId: input.requestId,
      wallet: input.wallet,
      day: utcDay(deps.now()),
      amount: notional,
      cap: cfg.daily,
      resolveAfter: new Date(input.expiresAt + RESOLVE_MARGIN_MS),
    });
  } catch (error) {
    if (error instanceof DailyCapExceeded) throw overDay(cfg, error.used);
    throw unavailable(error);
  }
}

/**
 * Solana Action quotes: a Blink client signs and sends the transaction itself, so Aroma never sees
 * a submit to reserve at or a failure to release on. The Action POST therefore reserves its
 * notional and KEEPS it for the UTC day, sent or not (conservative: the confirmed daily total can
 * only be lower than what is counted).
 */
export async function reserveActionQuote(
  deps: CapsDeps,
  input: Parameters<typeof reserveForSubmit>[1],
): Promise<void> {
  await reserveForSubmit(deps, input);
  try {
    await settle(deps.db(), input.requestId, "confirmed");
  } catch (cause) {
    throw unavailable(cause);
  }
}

/**
 * After submit (or a status read): confirmed keeps the reservation, failed releases it, anything
 * else leaves it reserved (resolved later from the chain). Never throws: a settle failure only
 * keeps the amount counting, which errs on the safe side.
 */
export async function settleReservation(
  deps: CapsDeps,
  requestId: string,
  status: string | null,
): Promise<void> {
  const outcome =
    status === "confirmed"
      ? "confirmed"
      : status === "failed"
        ? "released"
        : null;
  if (!outcome) return;
  try {
    await settle(deps.db(), requestId, outcome);
  } catch (error) {
    logger.warn(
      { err: error, requestId },
      "cap reservation not settled; it keeps counting",
    );
  }
}

/** A submit that threw: release only if the trade provably never left (no record, or failed). */
export async function settleAfterThrow(
  deps: CapsDeps,
  requestId: string,
): Promise<void> {
  try {
    const outcome = await deps.outcome(requestId);
    if (outcome === "failed") await settle(deps.db(), requestId, "released");
    else if (outcome === "confirmed")
      await settle(deps.db(), requestId, "confirmed");
  } catch (error) {
    logger.warn(
      { err: error, requestId },
      "cap reservation not settled; it keeps counting",
    );
  }
}
