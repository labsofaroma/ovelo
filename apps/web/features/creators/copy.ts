/** Creator dashboard wording (M11 Step 4). Counts from confirmed receipts; nothing invented. */
export const dashboardCopy = {
  title: "Creator dashboard",
  intro:
    "Your baskets' purchases from Ovelo's own confirmed receipts. Buyers are counted, never listed.",
  connect: "Connect the wallet you create baskets with.",
  cannotSign:
    "This wallet cannot sign messages, so it cannot open the dashboard.",
  open: "Sign to open your dashboard",
  openHint:
    "A read-only sign-in for 15 minutes. The signature does not move funds.",
  notCreator:
    "This wallet is not a creator yet. Redeem a creator invite in the basket builder.",
  noBaskets: "No baskets yet.",
  openBuilder: "Open the basket builder",
  noBuys: "No buys yet.",
  source: (source: string, asOf: string) =>
    `Source: ${source}. Updated ${asOf}. Pending and failed orders are not counted.`,
  windows: { "7d": "Last 7 days", "30d": "Last 30 days", all: "All time" },
  columns: {
    period: "Period",
    buys: "Buys",
    buyers: "Unique buyers",
    volume: "Volume",
    blink: "Through a Blink",
  },
  blink: (via: number, tracked: number, untracked: number) =>
    tracked === 0 && untracked === 0
      ? "—"
      : `${via} of ${tracked}${untracked > 0 ? ` (${untracked} earlier not recorded)` : ""}`,
  blinkNote: (since: string) =>
    `Blink buys are recorded from ${since}; earlier buys show as not recorded.`,
  versions: "Version history",
  noVersions: "Not published yet.",
  version: (n: number, at: string) => `Version ${n}, published ${at}`,
  status: { draft: "Draft", published: "Published", archived: "Archived" },
  copyLink: "Copy Blink link",
  copied: "Copied",
  shareX: "Share on X",
  shareTelegram: "Share on Telegram",
  edit: "Edit or publish a new version",
  publishDraft: "Finish and publish",
  archive: "Archive",
  archiveConfirm:
    "Archive this basket? It can no longer be bought; past buys stay recorded.",
  feeShare: "Fee share: off",
  feeShareNote: (entries: number) =>
    `Ovelo charges no platform fee during the beta, so there is nothing to share. ${entries} confirmed buy${entries === 1 ? " is" : "s are"} recorded in the fee-share ledger for the record; no payout exists.`,
} as const;
