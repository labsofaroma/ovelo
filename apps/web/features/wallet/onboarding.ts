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
  return `Your first buy of each stock needs about ${NEW_STOCK_ACCOUNT_SOL} SOL in your wallet for its token account, plus network fees. You pay these to the Solana network, not to Ovelo.`;
}

/**
 * M11: open this page inside a wallet's in-app browser on a phone (the wallets' documented
 * "browse" universal links; plain links, no referral or affiliate parameters beyond the page
 * itself as `ref`). Not verified on a real phone in this build.
 */
export function walletBrowseLinks(pageUrl: string): readonly WalletGuide[] {
  const url = encodeURIComponent(pageUrl);
  const ref = encodeURIComponent(new URL(pageUrl).origin);
  return [
    {
      name: "Phantom",
      href: `https://phantom.app/ul/browse/${url}?ref=${ref}`,
    },
    {
      name: "Solflare",
      href: `https://solflare.com/ul/v1/browse/${url}?ref=${ref}`,
    },
    {
      name: "Backpack",
      href: `https://backpack.app/ul/v1/browse/${url}?ref=${ref}`,
    },
  ];
}

/** Lamports for `accounts` new token accounts at NEW_STOCK_ACCOUNT_SOL each (bigint, exact). */
export function newAccountsLamports(accounts: number): bigint {
  const [whole, fraction = ""] = NEW_STOCK_ACCOUNT_SOL.split(".");
  const perAccount =
    BigInt(whole!) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  return perAccount * BigInt(accounts);
}
