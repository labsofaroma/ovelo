import type { NotifyEvent } from "./schema";

/**
 * Notification wording (M11 Step 1). Facts only: amounts from receipts, the cluster, one link.
 * No marketing, no performance, no advice. Devnet messages always say so in the title.
 */
export const DEVNET_PREFIX = "[Devnet test]";

export const eventLabel: Record<Exclude<NotifyEvent, "test">, string> = {
  trade_confirmed: "A purchase confirmed",
  trade_failed: "A purchase failed",
  trade_unconfirmed: "A purchase was not seen to confirm",
  creator_basket_bought: "Someone bought one of your baskets",
  plan_round_executed: "Devnet test plan: a round ran",
  plan_round_failed: "Devnet test plan: a round failed",
  plan_low_balance: "Devnet test plan: balance too low for the next round",
};

export const messages = {
  tradeConfirmed: (what: string, spent: string) => ({
    title: "Purchase confirmed",
    body: `${what}: ${spent} spent. Confirmed on Solana mainnet.`,
  }),
  tradeFailed: (what: string) => ({
    title: "Purchase failed",
    body: `${what}: a transaction of this order failed on Solana mainnet. A failed transaction swaps nothing, but its network fee is charged. Check the explorer and your portfolio.`,
  }),
  tradeUnconfirmed: (what: string) => ({
    title: "Purchase not confirmed yet",
    body: `${what}: Ovelo has not seen this transaction confirm on Solana mainnet after 15 minutes. Check it in the explorer.`,
  }),
  creatorBought: (basket: string, spent: string) => ({
    title: "Your basket was bought",
    body: `${basket}: one purchase of ${spent} confirmed on Solana mainnet.`,
  }),
  roundExecuted: (plan: string, period: number, spent: string) => ({
    title: `${DEVNET_PREFIX} Recurring round ran`,
    body: `Plan ${plan}, round ${period + 1}: ${spent} spent. Devnet test tokens have no value.`,
  }),
  roundFailed: (plan: string, period: number, code: string) => ({
    title: `${DEVNET_PREFIX} Recurring round failed`,
    body: `Plan ${plan}, round ${period + 1} could not run (${code}). The keeper stopped retrying it.`,
  }),
  lowBalance: (plan: string, balance: string, needed: string) => ({
    title: `${DEVNET_PREFIX} Balance too low for the next round`,
    body: `Plan ${plan}: your test balance is ${balance}; the next round needs ${needed}.`,
  }),
  test: (channel: string) => ({
    title: "Test notification from Ovelo",
    body: `You asked for this test on ${channel}. Notifications reach you here.`,
  }),
  spot: (symbol: string) => `${symbol}`,
  basket: (name: string) => `Basket ${name}`,
};

export const settingsCopy = {
  heading: "Notifications",
  intro:
    "Get a message when a purchase confirms or fails, when someone buys your basket, or when a devnet test plan runs. Off until you turn a channel on. Ovelo stores the channel's address only to send these messages, and deletes it when you turn the channel off.",
  disabled: "Notifications are paused on this deployment.",
  noChannels: "No notification channel is set up on this deployment yet.",
  connectFirst: "Connect a wallet to manage notifications.",
  cannotSign:
    "This wallet cannot sign messages, so it cannot manage notifications.",
  open: "Sign to open notification settings",
  openHint:
    "Your wallet signs a message to show it is yours. The signature does not move funds.",
  channel: { push: "Browser push", telegram: "Telegram" },
  channelHint: {
    push: "Notifications from this browser on this device.",
    telegram: "Messages from the Ovelo bot in Telegram.",
  },
  status: { pending: "Waiting for verification", active: "On", off: "Off" },
  turnOn: "Turn on",
  turnOff: "Turn off and delete",
  save: "Save events",
  test: "Send a test",
  testSent: "Test queued. It arrives within a few minutes.",
  telegramStep:
    "Open the link in Telegram and press Start. The link works once, for 15 minutes.",
  telegramOpen: "Open Telegram",
  checkAgain: "Check again",
  pushUnsupported: "This browser does not support push notifications.",
  pushDenied:
    "Notifications are blocked for this site in your browser settings.",
  deleteAll: "Delete all my notification data",
  deleted:
    "Deleted. Ovelo no longer stores a notification address for this wallet.",
  sessionEnded: "Your session ended. Sign again to continue.",
} as const;

/** Bot replies (plain text). */
export const botCopy = {
  linked:
    "Linked. Ovelo will send the notifications you chose to this chat. Send /stop to turn them off and delete this link.",
  badCode:
    "This link has expired or was already used. Turn Telegram on again in Ovelo's settings to get a new one.",
  stopped: "Stopped. Ovelo deleted the link between this chat and your wallet.",
  help: "This bot only sends Ovelo notifications. Turn it on in Ovelo's settings. Send /stop to turn it off.",
} as const;
