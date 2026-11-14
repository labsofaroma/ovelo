/**
 * Bring-your-own-wallet onboarding (REWRITE-PLAN §7.3 W1). Login is wallet-only: there is no
 * embedded or email wallet, so the connect screen links to install guides and states the SOL a
 * user needs before a first buy. Pure and client-safe.
 */

/**
 * About how much SOL the first buy of each stock needs for its token account (refundable rent),
 * before network fees. One constant: the connect screen and any onboarding copy read it from
 * here and never compute a per-user figure. Measured 2026-11-14 on mainnet: an xStock
 * (Token-2022) account is 179–182 bytes, 0.00156–0.00157 SOL; rounded up (REWRITE-PLAN §7.2).
 */
export const NEW_STOCK_ACCOUNT_SOL = "0.002";

export type WalletGuide = { name: string; href: string };

/** Official download pages of three widely used Solana wallets (Wallet Standard). */
export const WALLET_INSTALL_GUIDES: readonly WalletGuide[] = [
  { name: "Phantom", href: "https://phantom.com/download" },
  { name: "Solflare", href: "https://solflare.com/download" },
  { name: "Backpack", href: "https://backpack.app/downloads" },
];

/** The SOL note on the connect screen (mainnet only; devnet uses free test SOL). */
export function solNeededNote(): string {
  return `Your first buy of each stock needs about ${NEW_STOCK_ACCOUNT_SOL} SOL in your wallet for its token account, plus network fees. You pay these to the Solana network, not to Aroma.`;
}
