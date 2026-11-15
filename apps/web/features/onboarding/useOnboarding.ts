"use client";

import { useEffect, useRef } from "react";
import { usePortfolio } from "../portfolio/queries";
import { USDC_MINT } from "../trade/schema";
import { newAccountsLamports } from "../wallet/onboarding";
import { stepViewed, walletConnected, type OnboardingStep } from "./funnel";

/** Real balances for the funds step: SOL and USDC from the wallet's mainnet holdings. */
export function useOnboarding(address: string | null, tokens: number) {
  const portfolio = usePortfolio(address);
  const data = portfolio.data?.portfolio;
  const sol = data ? BigInt(data.sol.raw) : null;
  const usdc = data
    ? BigInt(data.holdings.find((h) => h.mint === USDC_MINT)?.raw ?? "0")
    : null;
  const needed = newAccountsLamports(tokens);
  const step: OnboardingStep = !address
    ? "wallet"
    : sol === null || sol < needed || usdc === 0n
      ? "funds"
      : "first_buy";
  const seen = useRef(new Set<OnboardingStep>());
  useEffect(() => {
    if (seen.current.has(step)) return;
    seen.current.add(step);
    stepViewed(step);
  }, [step]);
  const connectedOnce = useRef(false);
  useEffect(() => {
    if (address && !connectedOnce.current) {
      connectedOnce.current = true;
      walletConnected();
    }
  }, [address]);
  return {
    step,
    loading: Boolean(address) && portfolio.isPending,
    error: portfolio.isError,
    sol,
    usdc,
    needed,
  };
}
