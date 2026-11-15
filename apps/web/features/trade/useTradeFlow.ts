"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useSigner } from "../wallet/context";
import { tradeApi } from "./api";
import {
  flowReducer,
  initialFlow,
  PENDING_TRADE_KEY,
  type FlowError,
} from "./flow";
import {
  buildPaperQuote,
  fillPaper,
  loadPaperAccount,
  PAPER_KEY,
  type PaperLeg,
} from "./paper";
import { useFunnelEvents } from "../onboarding/useFunnelEvents";
import { useQuoteMutation, useSubmitMutation, useTradeStatus } from "./queries";
import type { QuoteRequestBody } from "./schema";

/**
 * One client state machine for stock, basket and paper trading (see flow.ts). Live orders: quote →
 * review (with a live expiry clock) → the wallet signs the exact unsigned bytes → submit →
 * confirmation polling. The in-flight trade id is kept in sessionStorage so a refresh resumes
 * tracking instead of inviting a duplicate order. Paper orders never build a transaction.
 */

export type TradeTarget =
  | { kind: "spot"; mint: string; legs: PaperLeg[] }
  | { kind: "basket"; basketId: string; legs: PaperLeg[] };

const toError = (error: unknown): FlowError => {
  const e = error as { code?: unknown; message?: unknown };
  return {
    code: typeof e?.code === "string" ? e.code : "INTERNAL",
    message:
      typeof e?.message === "string" && e.message
        ? e.message
        : "Something went wrong.",
  };
};

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function useTradeFlow(target: TradeTarget) {
  const [state, dispatch] = useReducer(flowReducer, initialFlow);
  const signer = useSigner();
  const quoteMutation = useQuoteMutation();
  const submitMutation = useSubmitMutation();
  const lastPaper = useRef<{
    amountUsd: string;
    prices: Awaited<ReturnType<typeof tradeApi.prices>>;
  } | null>(null);

  // Recovery after refresh.
  useEffect(() => {
    const id = session()?.getItem(PENDING_TRADE_KEY);
    if (id) dispatch({ type: "RECOVER", tradeId: id });
  }, []);

  // Review clock: expire the quote the moment it lapses.
  useEffect(() => {
    if (state.step !== "review") return;
    const timer = setInterval(
      () => dispatch({ type: "TICK", now: Date.now() }),
      1_000,
    );
    return () => clearInterval(timer);
  }, [state.step]);

  // M11: consent-gated funnel events (first live quote, confirmed buy). Never blocks the flow.
  useFunnelEvents(state, target.kind);

  const tracking = state.step === "confirming" ? state.tradeId : null;
  const status = useTradeStatus(tracking);
  useEffect(() => {
    if (status.data) dispatch({ type: "STATUS", record: status.data });
  }, [status.data]);
  useEffect(() => {
    // A remembered id the server does not know was never submitted: stop tracking it.
    if ((status.error as { code?: string } | null)?.code === "NOT_FOUND") {
      session()?.removeItem(PENDING_TRADE_KEY);
      dispatch({ type: "UNTRACKED" });
    }
  }, [status.error]);
  useEffect(() => {
    if (state.step === "done") session()?.removeItem(PENDING_TRADE_KEY);
  }, [state.step]);

  const quote = useCallback(
    async (input: {
      channel: "live" | "paper";
      amount: string;
      inputMint: string;
      slippageBps?: number;
    }) => {
      dispatch({ type: "QUOTE" });
      try {
        if (input.channel === "paper") {
          const prices = await tradeApi.prices(target.legs.map((l) => l.mint));
          lastPaper.current = { amountUsd: input.amount, prices };
          dispatch({
            type: "QUOTED",
            quote: buildPaperQuote(
              target.kind,
              target.legs,
              input.amount,
              prices,
              Date.now(),
            ),
          });
          return;
        }
        if (!signer)
          throw {
            code: "WALLET_REQUIRED",
            message: "Connect a mainnet wallet to get a quote.",
          };
        const body: QuoteRequestBody = {
          target:
            target.kind === "spot"
              ? { kind: "spot", mint: target.mint }
              : { kind: "basket", basketId: target.basketId },
          inputMint: input.inputMint,
          amount: input.amount,
          taker: signer.address,
          slippageBps: input.slippageBps ?? 100,
          supportedTransactionVersions: signer.supportedTransactionVersions,
        };
        const response = await quoteMutation.mutateAsync(body);
        dispatch({ type: "QUOTED", quote: { ...response, channel: "live" } });
      } catch (error) {
        dispatch({ type: "FAIL", error: toError(error) });
      }
    },
    [quoteMutation, signer, target],
  );

  const sign = useCallback(async () => {
    if (state.step !== "review") return;
    const quote = state.quote;
    if (quote.channel === "paper") {
      try {
        const paper = lastPaper.current;
        if (!paper) throw new Error("Request a new paper quote.");
        if (Date.now() >= quote.expiresAt) {
          dispatch({ type: "TICK", now: Date.now() });
          return;
        }
        const storage = (() => {
          try {
            return window.localStorage;
          } catch {
            return null;
          }
        })();
        const next = fillPaper(
          loadPaperAccount(storage),
          target.kind,
          target.legs,
          paper.amountUsd,
          paper.prices,
          new Date().toISOString(),
        );
        storage?.setItem(PAPER_KEY, JSON.stringify(next));
        dispatch({ type: "PAPER_FILLED" });
      } catch (error) {
        dispatch({ type: "FAIL", error: toError(error) });
      }
      return;
    }
    const now = Date.now();
    dispatch({ type: "SIGN", now });
    if (now >= quote.expiresAt) return;
    try {
      if (!signer)
        throw { code: "WALLET_REQUIRED", message: "Reconnect your wallet." };
      const signed = await signer.signTransactions(
        quote.transactions,
        quote.transactionVersion,
      );
      dispatch({ type: "SIGNED" });
      session()?.setItem(PENDING_TRADE_KEY, quote.requestId);
      const record = await submitMutation.mutateAsync({
        authorization: quote.authorization,
        signedTransactions: signed,
      });
      dispatch({ type: "SUBMITTED", record });
    } catch (error) {
      dispatch({ type: "FAIL", error: toError(error) });
    }
  }, [signer, state, submitMutation, target]);

  const cancel = useCallback(() => dispatch({ type: "CANCEL" }), []);
  return { state, quote, sign, cancel, signerConnected: Boolean(signer) };
}
