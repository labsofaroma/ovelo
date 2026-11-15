import type { QuoteResponse, TradeRecordView } from "./schema";

/**
 * The trade state machine shared by stock, basket and paper trading (REWRITE-PLAN §5.3):
 *
 *   idle → quoting → review → signing → submitting → confirming → done
 *                       ↘ expired (re-quote)          ↘ (recovery after refresh)
 *   any → error;  review/expired/error/done → idle (cancel or reset)
 *
 * Pure and framework-free so every transition is unit-tested. A quote can be signed only while
 * `now < expiresAt`; the clock is checked again at the moment of signing, not just at render.
 */

export type PaperQuote = {
  channel: "paper";
  kind: "spot" | "basket";
  /** USD spent, as typed (paper practice is never signed or sent). */
  amountUsd: string;
  legs: { symbol: string; priceUsd: string; quantity: string }[];
  pricesObservedAt: string | null;
  quotedAt: string;
  expiresAt: number;
};

/** `channel`, not `mode`: a live quote's `mode` is single vs bundle. */
export type LiveQuote = QuoteResponse & { channel: "live" };
export type AnyQuote = LiveQuote | PaperQuote;

export type FlowError = { code: string; message: string };

export type FlowState =
  | { step: "idle" }
  | { step: "quoting" }
  | { step: "review"; quote: AnyQuote }
  | { step: "expired"; quote: AnyQuote }
  | { step: "signing"; quote: LiveQuote }
  | { step: "submitting"; quote: LiveQuote }
  | { step: "confirming"; tradeId: string; record: TradeRecordView | null }
  | {
      step: "done";
      outcome: "confirmed" | "failed" | "unknown" | "paper";
      record: TradeRecordView | null;
    }
  | { step: "error"; error: FlowError; quote: AnyQuote | null };

export type FlowEvent =
  | { type: "QUOTE" }
  | { type: "QUOTED"; quote: AnyQuote }
  | { type: "TICK"; now: number }
  | { type: "SIGN"; now: number }
  | { type: "SIGNED" }
  | { type: "SUBMITTED"; record: TradeRecordView }
  | { type: "STATUS"; record: TradeRecordView }
  | { type: "PAPER_FILLED" }
  | { type: "RECOVER"; tradeId: string }
  | { type: "FAIL"; error: FlowError }
  | { type: "UNTRACKED" }
  | { type: "CANCEL" };

export const initialFlow: FlowState = { step: "idle" };

const FINAL = new Set(["confirmed", "failed"]);

function settle(record: TradeRecordView): FlowState {
  if (FINAL.has(record.status))
    return {
      step: "done",
      outcome: record.status as "confirmed" | "failed",
      record,
    };
  return { step: "confirming", tradeId: record.id, record };
}

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "QUOTE":
      return state.step === "signing" ||
        state.step === "submitting" ||
        state.step === "confirming"
        ? state
        : { step: "quoting" };
    case "QUOTED":
      return state.step === "quoting"
        ? { step: "review", quote: event.quote }
        : state;
    case "TICK":
      return state.step === "review" && event.now >= state.quote.expiresAt
        ? { step: "expired", quote: state.quote }
        : state;
    case "SIGN":
      if (state.step !== "review") return state;
      if (event.now >= state.quote.expiresAt)
        return { step: "expired", quote: state.quote };
      if (state.quote.channel === "paper") return state;
      return { step: "signing", quote: state.quote };
    case "SIGNED":
      return state.step === "signing"
        ? { step: "submitting", quote: state.quote }
        : state;
    case "SUBMITTED":
      return state.step === "submitting" ? settle(event.record) : state;
    case "STATUS":
      return state.step === "confirming" && state.tradeId === event.record.id
        ? settle(event.record)
        : state;
    case "PAPER_FILLED":
      return state.step === "review" && state.quote.channel === "paper"
        ? { step: "done", outcome: "paper", record: null }
        : state;
    case "RECOVER":
      return state.step === "idle"
        ? { step: "confirming", tradeId: event.tradeId, record: null }
        : state;
    case "FAIL":
      // A failure after the transactions left the wallet is not a safe retry: keep tracking.
      if (state.step === "confirming") return state;
      return {
        step: "error",
        error: event.error,
        quote: "quote" in state ? state.quote : null,
      };
    case "UNTRACKED":
      return state.step === "confirming"
        ? {
            step: "error",
            error: {
              code: "NOT_FOUND",
              message:
                "No submitted trade was found for this order; nothing was sent.",
            },
            quote: null,
          }
        : state;
    case "CANCEL":
      return state.step === "signing" ||
        state.step === "submitting" ||
        state.step === "confirming"
        ? state
        : initialFlow;
  }
}

/** Seconds since the quote (as-of age) and until expiry, for the review screen. */
export function quotedAtOf(quote: AnyQuote): string {
  return quote.channel === "live" ? quote.quote.quotedAt : quote.quotedAt;
}

export function quoteClock(quote: AnyQuote, now: number) {
  const quotedAt = Date.parse(quotedAtOf(quote));
  return {
    ageSeconds: Math.max(0, Math.floor((now - quotedAt) / 1000)),
    remainingSeconds: Math.max(0, Math.ceil((quote.expiresAt - now) / 1000)),
  };
}

/** sessionStorage key holding the in-flight trade id, so a refresh can resume tracking. */
export const PENDING_TRADE_KEY = "ovelo.v1.pendingTrade";
