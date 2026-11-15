// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardCopy } from "../copy";
import type { DashboardData } from "../dashboard-schema";

vi.mock("../../wallet/ConnectButton", () => ({
  ConnectButton: () => <button type="button">Connect wallet</button>,
}));
const { DashboardView } = await import("./DashboardIsland");
afterEach(cleanup);

const WALLET = "7e5pxK83ceXb2iWXBizF1U8MdL7C5VcVBBXpDWaYo3x1";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const data = (baskets: DashboardData["baskets"]): DashboardData => ({
  wallet: WALLET,
  displayName: "Alice",
  asOf: "2026-11-20T12:00:00.000Z",
  source: "Aroma purchase receipts",
  blinkTrackingSince: "2026-11-15T00:00:00.000Z",
  baskets,
});
const basket = (
  over: Partial<DashboardData["baskets"][number]> = {},
): DashboardData["baskets"][number] => ({
  id: "8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20",
  name: "Chips",
  ticker: "CHIPS",
  status: "published",
  version: 2,
  publishedAt: "2026-10-01T00:00:00.000Z",
  usage: {
    state: "ok",
    asOf: "2026-11-20T12:00:00.000Z",
    source: "receipts",
    windows: [
      {
        window: "7d",
        since: "x",
        purchases: 2,
        buyers: 2,
        volume: [{ mint: USDC, symbol: "USDC", decimals: 6, raw: "4000000" }],
      },
      {
        window: "30d",
        since: "x",
        purchases: 2,
        buyers: 2,
        volume: [{ mint: USDC, symbol: "USDC", decimals: 6, raw: "4000000" }],
      },
      {
        window: "all",
        since: null,
        purchases: 3,
        buyers: 3,
        volume: [{ mint: USDC, symbol: "USDC", decimals: 6, raw: "6000000" }],
      },
    ],
  },
  blink: [
    { window: "7d", tracked: 2, viaAction: 1, untracked: 0 },
    { window: "30d", tracked: 2, viaAction: 1, untracked: 0 },
    { window: "all", tracked: 2, viaAction: 1, untracked: 1 },
  ],
  feeShare: { state: "off", entries: 3, shareRaw: "0" },
  versions: [
    {
      version: 2,
      name: "Chips",
      publishedAt: "2026-10-01T00:00:00.000Z",
      allocations: [{ mint: "m", symbol: "AAx", weightBps: 5000 }],
    },
  ],
  ...over,
});
const state = (over = {}) => ({
  data: null,
  error: null,
  busy: false,
  open: vi.fn(),
  signedIn: false,
  ...over,
});
const props = {
  canSign: true,
  origin: "https://aroma.example",
  onArchive: vi.fn(),
  archivingId: null,
};

describe("DashboardView", () => {
  it("not connected, cannot sign, not a creator: one honest line each", () => {
    const { rerender } = render(
      <DashboardView wallet={null} {...props} state={state()} />,
    );
    expect(screen.getByText(dashboardCopy.connect)).toBeTruthy();
    rerender(
      <DashboardView
        wallet={WALLET}
        {...props}
        canSign={false}
        state={state()}
      />,
    );
    expect(screen.getByText(dashboardCopy.cannotSign)).toBeTruthy();
    rerender(
      <DashboardView
        wallet={WALLET}
        {...props}
        state={state({ error: { code: "FORBIDDEN", message: "x" } })}
      />,
    );
    expect(screen.getByText(dashboardCopy.notCreator)).toBeTruthy();
  });

  it("buys, unique buyers (a count), volume, Blink share with earlier buys not recorded", () => {
    render(
      <DashboardView
        wallet={WALLET}
        {...props}
        state={state({ data: data([basket()]) })}
      />,
    );
    const all = screen.getByRole("row", { name: /All time/ });
    expect(
      within(all)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["3", "3", "6.000000 USDC", "1 of 2 (1 earlier not recorded)"]);
    expect(screen.getByText(/Version 2, published/)).toBeTruthy();
    expect(screen.getByText(/Fee share: off/).textContent).toContain(
      "3 confirmed buys are recorded in the fee-share ledger",
    );
  });

  it("share links carry only the basket URL; archive asks first", () => {
    const onArchive = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <DashboardView
        wallet={WALLET}
        {...props}
        onArchive={onArchive}
        state={state({ data: data([basket()]) })}
      />,
    );
    const url = encodeURIComponent(
      "https://aroma.example/basket/8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20",
    );
    expect(
      screen
        .getByRole("link", { name: dashboardCopy.shareX })
        .getAttribute("href"),
    ).toBe(`https://twitter.com/intent/tweet?url=${url}`);
    fireEvent.click(
      screen.getByRole("button", { name: dashboardCopy.archive }),
    );
    expect(onArchive).toHaveBeenCalledWith(
      "8b2e1c4a-6f0d-4c1e-9a3b-2d5f7e9c1a20",
    );
  });

  it("no buys yet; a draft offers to finish and publish, not to share", () => {
    render(
      <DashboardView
        wallet={WALLET}
        {...props}
        state={state({
          data: data([
            basket({
              status: "draft",
              versions: [],
              usage: { state: "none", asOf: "x", source: "y" },
            }),
          ]),
        })}
      />,
    );
    expect(screen.getByText(dashboardCopy.noBuys)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: dashboardCopy.publishDraft }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: dashboardCopy.shareX }),
    ).toBeNull();
  });
});
