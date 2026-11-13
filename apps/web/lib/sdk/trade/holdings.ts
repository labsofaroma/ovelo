import { fromTokenAmount, toTokenAmount } from "../core/amounts";
import {
  MAINNET_SOL_MINT,
  type MainnetHolding,
  type OnChainTokenBalance,
} from "./types";
import type { MarketAsset } from "../markets";

/** Aggregate every owner account, including Token-2022 and non-associated accounts.
 * Frozen funds remain visible but cannot be offered by Max. Invalid RPC rows fail
 * closed instead of turning an incompletely parsed wallet into a zero balance.
 */
export function aggregateTokenBalances(
  accounts: readonly unknown[],
  owner: string,
): OnChainTokenBalance[] {
  const balances = new Map<
    string,
    {
      raw: bigint;
      spendable: bigint;
      displayRaw: bigint | null;
      decimals: number;
      tokenProgram: string;
    }
  >();
  const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  for (const entry of accounts) {
    const account = object(object(entry).account);
    const parsed = object(object(account.data).parsed);
    const info = object(parsed.info);
    const tokenAmount = object(info.tokenAmount);
    const { amount, decimals } = tokenAmount;
    if (
      parsed.type !== "account" ||
      info.owner !== owner ||
      typeof info.mint !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(info.mint) ||
      typeof account.owner !== "string" ||
      ![
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      ].includes(account.owner) ||
      typeof amount !== "string" ||
      !/^\d+$/.test(amount) ||
      BigInt(amount) > BigInt("18446744073709551615") ||
      typeof decimals !== "number" ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 255 ||
      (info.state !== "initialized" && info.state !== "frozen")
    )
      throw new Error(
        "RPC returned an unsupported token account. Wallet balances could not be verified completely.",
      );
    const previous = balances.get(info.mint);
    if (
      previous &&
      (previous.decimals !== decimals ||
        previous.tokenProgram !== account.owner)
    )
      throw new Error("RPC returned inconsistent token balances.");
    let displayRaw: bigint | null = null;
    try {
      if (typeof tokenAmount.uiAmountString === "string")
        displayRaw = /^0(?:\.0+)?$/.test(tokenAmount.uiAmountString)
          ? BigInt(0)
          : BigInt(toTokenAmount(tokenAmount.uiAmountString, decimals));
    } catch {
      /* Scaled balances are unknown when the RPC display precision cannot be preserved. */
    }
    balances.set(info.mint, {
      raw: (previous?.raw ?? BigInt(0)) + BigInt(amount),
      spendable:
        (previous?.spendable ?? BigInt(0)) +
        (info.state === "initialized" ? BigInt(amount) : BigInt(0)),
      displayRaw:
        displayRaw === null || previous?.displayRaw === null
          ? null
          : (previous?.displayRaw ?? BigInt(0)) + displayRaw,
      decimals,
      tokenProgram: account.owner,
    });
  }
  return [...balances]
    .filter(([, balance]) => balance.raw > BigInt(0))
    .map(([mint, balance]) => ({
      mint,
      decimals: balance.decimals,
      rawAmount: balance.raw.toString(),
      spendableRawAmount: balance.spendable.toString(),
      displayAmount:
        balance.displayRaw === null
          ? null
          : fromTokenAmount(balance.displayRaw.toString(), balance.decimals),
      tokenProgram: balance.tokenProgram,
    }));
}

/** A conservative SOL buffer, not a fee quote. The live route still checks fees and rent. */
export const SWAP_SOL_RESERVE_LAMPORTS = "10000000";
export function maxSwapAmount(holding: MainnetHolding | undefined): string {
  if (
    !holding ||
    holding.decimals === undefined ||
    holding.tradingHalted ||
    holding.spendableAmount === undefined ||
    /^0(?:\.0+)?$/.test(holding.spendableAmount)
  )
    return "0";
  try {
    let raw = BigInt(toTokenAmount(holding.spendableAmount, holding.decimals));
    if (holding.mint === MAINNET_SOL_MINT)
      raw -= BigInt(SWAP_SOL_RESERVE_LAMPORTS);
    return raw > BigInt(0)
      ? fromTokenAmount(raw.toString(), holding.decimals)
      : "0";
  } catch {
    return "0";
  }
}
