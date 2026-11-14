// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  wallet: { status: "disconnected", signer: null, error: null } as {
    status: string;
    signer: { address: string } | null;
    error: string | null;
  },
  status: vi.fn(),
}));
vi.mock("../../wallet/WalletBoundary", () => ({
  WalletBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../wallet/ConnectButton", () => ({
  ConnectButton: () => <button type="button">wallet control</button>,
}));
vi.mock("../../wallet/context", () => ({ useWallet: () => state.wallet }));
vi.mock("../../compliance/api", () => ({
  complianceApi: { status: state.status },
}));

const { SettingsWallet } = await import("./SettingsWallet");
const WALLET = "7e5pxK83ceXb2iWXBizF1U8MdL7C5VcVBBXpDWaYo3x1";
afterEach(() => {
  cleanup();
  state.status.mockReset();
  state.wallet = { status: "disconnected", signer: null, error: null };
});

const terms = (accepted: boolean | null) => ({
  jurisdiction: "allowed",
  trade: true,
  browse: true,
  terms: {
    version: "2026-09-13-placeholder",
    hash: "h",
    final: false,
    accepted,
  },
});

describe("SettingsWallet (/settings)", () => {
  it("without a wallet: says so, offers the wallet control, asks the server nothing", () => {
    render(<SettingsWallet />);
    expect(screen.getByText(/No wallet connected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "wallet control" })).toBeTruthy();
    expect(state.status).not.toHaveBeenCalled();
  });

  it.each([
    [true, "Yes, the current version"],
    [false, /Not yet/],
  ] as const)(
    "terms accepted=%s comes from the compliance API, read-only",
    async (accepted, text) => {
      state.wallet = {
        status: "connected",
        signer: { address: WALLET },
        error: null,
      };
      state.status.mockResolvedValue(terms(accepted));
      render(<SettingsWallet />);
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.getByText("2026-09-13-placeholder")).toBeTruthy();
      expect(state.status).toHaveBeenCalledWith(WALLET);
    },
  );

  it("an unavailable status is said plainly, never shown as 'not accepted'", async () => {
    state.wallet = {
      status: "connected",
      signer: { address: WALLET },
      error: null,
    };
    state.status.mockRejectedValue(new Error("The network request failed."));
    render(<SettingsWallet />);
    expect(
      await screen.findByText(/terms status is unavailable/, undefined, {
        timeout: 5_000,
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/Not yet/)).toBeNull();
  });
});
