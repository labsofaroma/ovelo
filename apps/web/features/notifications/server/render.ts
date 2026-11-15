import { messages } from "../copy";
import type { NotifyMessage } from "./channels/types";

/**
 * Event row → message. Pure: everything comes from the event's payload (written from receipts
 * or the devnet keeper), formatted with integer math. An unknown or malformed payload renders
 * nothing (the delivery is dead-lettered), never a guessed message.
 */
export type EventRow = {
  id: string;
  kind: string;
  cluster: "mainnet" | "devnet";
  payload: Record<string, unknown>;
};

const DECIMALS: Record<string, { symbol: string; decimals: number }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  So11111111111111111111111111111111111111112: { symbol: "SOL", decimals: 9 },
};

/** Raw units → exact decimal text (trailing zeros trimmed). Bigint only. */
export function formatRaw(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) throw new Error("raw amount");
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function amount(
  raw: unknown,
  mint: unknown,
  symbol?: unknown,
  decimals?: unknown,
) {
  if (typeof raw !== "string" || typeof mint !== "string") return null;
  const known = DECIMALS[mint];
  const dec = typeof decimals === "number" ? decimals : known?.decimals;
  const sym = typeof symbol === "string" ? symbol : known?.symbol;
  if (dec === undefined || sym === undefined)
    return `${raw} raw units of ${mint.slice(0, 4)}…`;
  return `${formatRaw(raw, dec)} ${sym}`;
}

const short = (value: string) => `${value.slice(0, 4)}…${value.slice(-4)}`;
const tx = (signature: string, cluster: "mainnet" | "devnet") =>
  `https://solscan.io/tx/${encodeURIComponent(signature)}${cluster === "devnet" ? "?cluster=devnet" : ""}`;

export function renderEvent(
  event: EventRow,
  site: string,
): NotifyMessage | null {
  const p = event.payload;
  const str = (k: string) =>
    typeof p[k] === "string" ? (p[k] as string) : null;
  const num = (k: string) =>
    typeof p[k] === "number" ? (p[k] as number) : null;
  try {
    switch (event.kind) {
      case "trade_confirmed":
      case "trade_failed":
      case "trade_unconfirmed": {
        const signature = str("signature");
        const label = str("label");
        if (!signature || !label || event.cluster !== "mainnet") return null;
        const what =
          str("target") === "basket"
            ? messages.basket(label)
            : messages.spot(label);
        const spent = amount(p.amountRaw, p.mint);
        const text =
          event.kind === "trade_confirmed"
            ? spent && messages.tradeConfirmed(what, spent)
            : event.kind === "trade_failed"
              ? messages.tradeFailed(what)
              : messages.tradeUnconfirmed(what);
        return text ? { ...text, url: tx(signature, "mainnet") } : null;
      }
      case "creator_basket_bought": {
        const basketId = str("basketId");
        const name = str("basketName");
        const spent = amount(p.amountRaw, p.mint);
        if (!basketId || !name || !spent) return null;
        return {
          ...messages.creatorBought(name, spent),
          url: `${site}/basket/${encodeURIComponent(basketId)}`,
        };
      }
      case "plan_round_executed": {
        const plan = str("plan");
        const period = num("period");
        const signature = str("signature");
        const spent = amount(p.amountRaw, p.mint, p.symbol, p.decimals);
        if (
          !plan ||
          period === null ||
          !signature ||
          !spent ||
          event.cluster !== "devnet"
        )
          return null;
        return {
          ...messages.roundExecuted(short(plan), period, spent),
          url: tx(signature, "devnet"),
        };
      }
      case "plan_round_failed": {
        const plan = str("plan");
        const period = num("period");
        const code = str("code");
        if (!plan || period === null || !code || event.cluster !== "devnet")
          return null;
        return {
          ...messages.roundFailed(short(plan), period, code),
          url: `${site}/invest`,
        };
      }
      case "plan_low_balance": {
        const plan = str("plan");
        const balance = amount(p.balanceRaw, p.mint, p.symbol, p.decimals);
        const needed = amount(p.neededRaw, p.mint, p.symbol, p.decimals);
        if (!plan || !balance || !needed || event.cluster !== "devnet")
          return null;
        return {
          ...messages.lowBalance(short(plan), balance, needed),
          url: `${site}/invest`,
        };
      }
      case "test": {
        const channel = str("channel");
        if (!channel) return null;
        return {
          ...messages.test(channel === "push" ? "browser push" : "Telegram"),
          url: `${site}/settings`,
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
