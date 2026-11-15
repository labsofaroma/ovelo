import type { LegalDocument } from "../schema";

/**
 * Text ported unchanged from app/terms/page.tsx (prototype). The prototype page shows the
 * shared "Updated 13 September 2026" line from LegalPage. Change both copies until M7.
 */
export const termsDocument = {
  title: "Terms & conditions",
  description:
    "Terms for exploring tokenized assets, paper trading and wallet-approved swaps in Ovelo.",
  introduction:
    "Know what the interface does, what you approve, and where the responsibilities sit.",
  updated: "2026-09-13",
  sections: [
    {
      heading: "Using Ovelo",
      paragraphs: [
        "Ovelo provides market information, a local paper-trading simulation and tools for wallet-approved Solana swaps. Use it only where you are legally eligible and comply with the terms and geographic restrictions of each issuer and service provider. Access to this interface does not establish eligibility to buy any asset.",
      ],
    },
    {
      heading: "Paper mode and market information",
      paragraphs: [
        "Paper funds and fills are simulated. They cannot be withdrawn and do not establish actual ownership, executable liquidity or investment performance. Quotes, prices, research and calculations may be delayed, unavailable or incorrect. Company research concerns the underlying company; a token’s rights, price and liquidity can differ. Nothing in the interface is personalised investment, tax or legal advice.",
      ],
    },
    {
      heading: "Wallet-approved transactions",
      paragraphs: [
        "Review the input and output assets, mint addresses, amount, fees, minimum received and expiry before approving. You remain responsible for your wallet and credentials. Network fees may be charged even when a transaction fails. Transactions recorded onchain are generally irreversible, and a lost execution response does not prove a trade failed. Check wallet activity before submitting again.",
      ],
    },
    {
      heading: "Baskets and recurring plans",
      paragraphs: [
        "The currently available recurring plans and basket simulations are labelled paper trading. Experimental protocol and SDK modules do not imply a deployed, audited or continuously running investment service. Any future real recurring plan requires its own supported deployment, explicit authorisation and disclosed execution limits.",
      ],
    },
    {
      heading: "Third-party services and risks",
      paragraphs: [
        "Wallets, sign-in services, RPCs, routing providers, asset issuers and trading venues operate independently. Their fees and policies apply. Tokenized assets involve market, liquidity, issuer, redemption, software and network risks, including possible loss of the full amount committed. No return, liquidity or continuous availability is promised.",
      ],
    },
    {
      heading: "Acceptable use and availability",
      paragraphs: [
        "Do not attempt to bypass eligibility or security controls, disrupt the API, abuse provider quotas, submit deceptive transactions or access another person’s credentials. Access may be limited to protect the service. Features can change or become unavailable. Applicable mandatory consumer rights are not excluded by this notice.",
      ],
    },
  ],
} satisfies LegalDocument;
