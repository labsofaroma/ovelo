import type { MarketBasket } from "../../markets";

export const MAX_CUSTOM_BASKET_LEGS = 12;
export const MIN_CUSTOM_BASKET_LEGS = 2;

export interface BasketAllocation {
  mint: string;
  symbol: string;
  name?: string;
  weightBps: number;
}

export interface RebalanceRules {
  driftThresholdBps: number;
  schedule?: "none" | "weekly" | "monthly";
}

export interface ProgrammableBasket {
  id: string;
  name: string;
  ticker: string;
  description: string;
  category?: MarketBasket["category"] | "custom";
  allocations: BasketAllocation[];
  rebalanceRules: RebalanceRules;
  createdAt: string;
  updatedAt: string;
  isCustom: true;
  creatorName?: string;
  creatorSocial?: string;
}
