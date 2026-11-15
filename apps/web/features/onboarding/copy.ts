import { NEW_STOCK_ACCOUNT_SOL } from "../wallet/onboarding";

/** /get-started wording (M11 Step 3). Facts and steps only: no recommendation, no performance. */
export const onboardingCopy = {
  title: "Get started",
  eyebrow: (n: number) => `Step ${n} of 3`,
  headerEyebrow: "Three steps",
  pickerLink: "New to Solana wallets? Get started step by step",
  intro:
    "Three steps to a first purchase from your own wallet: a Solana wallet, a little SOL and USDC, then a first buy. Ovelo never holds your keys or funds.",
  step1: "1. A Solana wallet",
  step2: "2. SOL and USDC in that wallet",
  step3: "3. A first buy",
  connected: (short: string) => `Connected: ${short}`,
  noWallet:
    "Install one of these wallets, create or import an account in it, then connect it here.",
  phone: "On a phone? Open this page inside your wallet app:",
  phoneHint: "Each link opens the wallet app's own browser at this page.",
  balancesLoading: "Reading this wallet's balances from Solana mainnet…",
  balancesUnavailable:
    "Balances are unavailable right now. Try again in a minute.",
  balances: (sol: string, usdc: string) =>
    `This wallet has ${sol} SOL and ${usdc} USDC on Solana mainnet.`,
  solNeeded: (tokens: number, sol: string) =>
    `The suggested basket below has ${tokens} token${tokens === 1 ? "" : "s"}. A first buy of each needs about ${NEW_STOCK_ACCOUNT_SOL} SOL for its token account (${sol} SOL in all), plus network fees, paid to the Solana network, not to Ovelo.`,
  solOk:
    "That is enough SOL for those token accounts (network fees come on top).",
  solShort: (missing: string) =>
    `You need about ${missing} SOL more for those token accounts, plus network fees.`,
  usdcNone: "This wallet has no USDC. Ovelo's purchases are paid in USDC.",
  usdcLimit: (cap: string) =>
    `During the beta each purchase is limited to ${cap}.`,
  fund: "To add SOL or USDC, use the Buy feature inside your wallet app, or send them from an exchange account you already have. Ovelo does not sell or exchange crypto and links to no exchange.",
  suggestion: (name: string, tokens: number) =>
    `${name} (${tokens} token${tokens === 1 ? "" : "s"})`,
  suggestionWhy:
    "Shown because it has the fewest tokens of the baskets available in today's catalog, so it needs the least SOL for token accounts. It is a starting point, not a recommendation: Ovelo does not give investment advice.",
  suggestionNone:
    "No basket is available right now. You can still buy a single stock from Markets.",
  open: "Open the trade ticket",
  orStock: "Or choose any stock in Markets",
  gates:
    "The ticket asks you to accept the terms and, during the private beta, to redeem an invite before the first quote.",
  paused: "Mainnet purchases are paused by the operator right now.",
} as const;
