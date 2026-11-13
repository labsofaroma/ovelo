"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createAromaCore, executePaperOrder, executePaperSwap, valuePaperAccount, executePaperBasket, createPaperPlan, togglePaperPlan, executePaperRebalance } from "@/lib/sdk";
import type { MarketAsset, MarketSnapshot, PaperAccount, MarketBasket, PaperPlan, ProgrammableBasket } from "@/lib/sdk";
import { aromaClient } from "./api-client";

import { useTradingMode, type TradingMode as Mode } from "./useTradingMode";
type Portfolio = ReturnType<typeof valuePaperAccount>;
interface AromaState {
  snapshot: MarketSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  paper: PaperAccount;
  portfolio: Portfolio;
  hydrated: boolean;
  accountReadFailed: boolean;
  mode: Mode;
  setMode: (mode: Mode) => void;
  watchlist: string[];
  toggleWatch: (mint: string) => void;
  trade: (asset: MarketAsset, side: "buy" | "sell", amountUsd: number) => void;
  swap: (
    inputAsset: MarketAsset,
    outputAsset: MarketAsset,
    inputQuantity: number,
  ) => void;
  tradeBasket: (basket: MarketBasket, amountUsd: number) => void;
  createPlan: (
    input: Pick<
      PaperPlan,
      "targetId" | "targetType" | "name" | "amountUsd" | "frequency"
    >,
  ) => void;
  togglePlan: (id: string) => void;
  resetPaper: () => void;
  toast: string | null;
  notify: (message: string) => void;
  clearToast: () => void;
  storageError: string | null;
  customBaskets: ProgrammableBasket[];
  saveCustomBasket: (basket: ProgrammableBasket) => void;
  deleteCustomBasket: (id: string) => void;
  rebalancePaper: (basket: ProgrammableBasket, thresholdBps?: number) => { rebalanced: boolean; legs: any[] };
}
const Context = createContext<AromaState | null>(null);
export function AromaProvider({ children }: { children: React.ReactNode }) {
  const [core] = useState(() => createAromaCore({
    client: aromaClient,
    storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
    accountKey: "aroma.paper.mainnet.v1", watchlistKey: "aroma.watchlist.mainnet.v1",
    marketKey: "aroma.market.mainnet.v1",
  }));
  const state = useSyncExternalStore(core.subscribe, core.getSnapshot, core.getSnapshot);
  const [mode, setMode] = useTradingMode();
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    const visibility = () => core.setActive(document.visibilityState === "visible");
    visibility(); core.start();
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); core.stop(); };
  }, [core]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const refresh = useCallback(() => core.refresh(), [core]);
  const trade = useCallback((asset: MarketAsset, side: "buy" | "sell", amountUsd: number) => {
    core.updateAccount(account => executePaperOrder(account, asset, side, amountUsd));
    setToast(`Paper ${side} recorded for ${asset.symbol}.`);
  }, [core]);
  const swap = useCallback((input: MarketAsset, output: MarketAsset, quantity: number) => {
    core.updateAccount(account => executePaperSwap(account, input, output, quantity));
    setToast(`Paper swap recorded: ${input.symbol} to ${output.symbol}.`);
  }, [core]);
  const tradeBasket = useCallback((basket: MarketBasket, amountUsd: number) => {
    core.updateAccount(account => executePaperBasket(account, basket, amountUsd));
    setToast("Paper basket purchase recorded.");
  }, [core]);
  const createPlan = useCallback((input: Pick<PaperPlan, "targetId" | "targetType" | "name" | "amountUsd" | "frequency">) => {
    core.updateAccount(account => createPaperPlan(account, input));
    setToast("Recurring paper plan created.");
  }, [core]);
  const togglePlan = useCallback((id: string) => core.updateAccount(account => togglePaperPlan(account, id)), [core]);
  const saveCustomBasket = useCallback((basket: ProgrammableBasket) => {
    core.saveCustomBasket(basket);
    setToast(`Saved custom basket "${basket.name}".`);
  }, [core]);
  const deleteCustomBasket = useCallback((id: string) => {
    core.deleteCustomBasket(id);
    setToast("Custom basket removed.");
  }, [core]);
  const rebalancePaper = useCallback((basket: ProgrammableBasket, thresholdBps = 500) => {
    let result = { rebalanced: false, legs: [] as any[] };
    core.updateAccount(account => {
      const res = executePaperRebalance(account, basket.allocations, state.market?.assets ?? [], thresholdBps);
      result = res;
      return res.account;
    });
    if (result.rebalanced) {
      setToast(`Rebalanced "${basket.name}" positions.`);
    } else {
      setToast(`"${basket.name}" allocations within threshold.`);
    }
    return result;
  }, [core, state.market]);
  const portfolio = useMemo(() => valuePaperAccount(state.account, state.market?.assets ?? []), [state.account, state.market]);
  const value: AromaState = {
    snapshot: state.market, paper: state.account, portfolio,
    loading: state.loading, error: state.error, hydrated: state.hydrated,
    accountReadFailed: state.accountReadFailed, storageError: state.storageError,
    mode, setMode, toast, notify: setToast, clearToast: () => setToast(null),
    watchlist: state.watchlist, toggleWatch: core.toggleWatch,
    refresh, trade, swap, tradeBasket, createPlan, togglePlan,
    resetPaper: () => { core.resetAccount(); setToast("Paper account reset."); },
    customBaskets: state.customBaskets ?? [],
    saveCustomBasket, deleteCustomBasket, rebalancePaper,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAroma() {
  const value = useContext(Context);
  if (!value) throw new Error("useAroma must be used within AromaProvider");
  return value;
}
