import type { LegalDocument } from "../schema";

/**
 * Text ported from app/privacy/page.tsx (prototype, updated 13 September 2026). The operator name
 * is filled in at render. M11 adds the notification section (draft wording for counsel's review,
 * docs/launch/COMPLIANCE.md).
 */
export const privacyDocument = {
  title: "Privacy policy",
  description:
    "How Ovelo handles local paper accounts, wallet information and optional analytics.",
  introduction:
    "A clear view of the information used when you explore, practise and trade with Ovelo.",
  updated: "2026-11-15",
  sections: [
    {
      heading: "Who operates this interface",
      paragraphs: [
        "This version of Ovelo is maintained by {operator}. This notice describes the data flows implemented in this interface. Your wallet, asset issuer and service providers also have their own policies.",
      ],
    },
    {
      heading: "Paper activity stays on your device",
      paragraphs: [
        "Your virtual account, orders, recurring paper plans and watchlist are saved in browser storage or the mobile app’s local storage. They are not automatically synchronised between devices. You can reset your paper account in Settings or remove the app’s local data. Clearing browser data also removes locally saved activity.",
      ],
    },
    {
      heading: "Wallet and sign-in information",
      paragraphs: [
        "When you connect a wallet, the API uses your public wallet address to read balances and prepare trades. When you approve a transaction, its signed payload is sent for execution. Private keys are not requested by Ovelo’s API. Native wallet authorisation tokens are kept in device secure storage; unresolved trade identifiers may be saved locally to prevent repeat submissions.",
        "Ovelo has no accounts or email sign-in: you connect your own wallet. Your wallet provider and RPC providers process the requests needed for signing, balances and transactions. Onchain transactions are public and cannot be erased by clearing Ovelo data.",
      ],
    },
    {
      heading: "Market providers and technical requests",
      paragraphs: [
        "The server requests asset metadata, prices and company research from the sources identified in the app, including Jupiter, asset issuers, Yahoo Finance and Wikipedia. Hosting and network providers receive technical information such as your IP address, request path, browser details and request timing. Retention of their operational logs depends on the deployment and provider settings. Ovelo does not promise that external providers retain no logs.",
      ],
    },
    {
      heading: "Cookies, local storage and analytics",
      paragraphs: [
        "Essential storage supports paper activity, preferences and sign-in. Wallet and sign-in providers may use storage necessary for the features you request. Optional Ovelo usage analytics are disabled unless the deployment configures them and you select Allow analytics. When enabled, Plausible receives page categories and basic request information; Ovelo excludes wallet addresses, transaction payloads, query parameters and form values from analytics events.",
        "Use Privacy choices at the bottom of any page to decline or withdraw optional analytics. Your preference is kept on this device. We do not load advertising trackers in this implementation.",
      ],
    },
    {
      heading: "Notifications (optional)",
      paragraphs: [
        "Notifications are off until you turn a channel on in Settings and sign with your wallet. For browser push, Ovelo stores the push subscription your browser creates (an address at your browser's push service and its encryption keys). For Telegram, Ovelo stores the chat id of the chat that sent the one-time code to the Ovelo bot. Ovelo does not collect email addresses. These details are used only to send the notifications you chose, are never shown in analytics or logs, and are not shared except with the push service or Telegram that delivers each message.",
        "Messages state facts from Ovelo's own records: an amount, a cluster label and an explorer link. Delivery records are deleted after 30 days. Turning a channel off, sending /stop to the bot, or choosing Delete all my notification data in Settings deletes the stored details at once.",
      ],
    },
    {
      heading: "Your choices",
      paragraphs: [
        "You can use paper mode without connecting a wallet, disconnect your wallet, decline analytics and remove locally saved data. For access, correction or deletion questions about information handled by the deployment operator, contact the maintainers. Rights and available remedies depend on your location and the applicable law; external providers handle requests about information they control.",
      ],
    },
  ],
} satisfies LegalDocument;
