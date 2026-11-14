import type { ClusterConfig } from "../../wallet/cluster";
import type { WizardAsset, WizardBasket } from "../wizard";

/** Plain, serialisable props the server page passes to the invest island. */
export type InvestPageData = {
  /** The wallet boundary's cluster (devnet, or localnet in a test build). */
  wallet: ClusterConfig;
  cluster: "devnet" | "localnet";
  /** RPC used for explorer links on localnet. */
  explorerRpcUrl: string;
  assets: WizardAsset[];
  baskets: WizardBasket[];
  catchUpWindowPeriods: number;
  /** Launch cap per installment, raw units. */
  maxInstallmentRaw: string;
  fundingSymbol: string;
  fundingDecimals: number;
  /** Cloudflare Turnstile site key, or null when the faucet is not configured. */
  turnstileSiteKey: string | null;
  /** The faucet's fixed test USD amount, raw units. */
  faucetAmountRaw: string;
  /** The request's CSP nonce, for the Turnstile script. */
  nonce: string | null;
};
