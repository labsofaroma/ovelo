// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { idleWallet, type WalletState } from "./context";
import { NEW_STOCK_ACCOUNT_SOL, WALLET_INSTALL_GUIDES } from "./onboarding";
import { WalletPicker } from "./stack/WalletPicker";

/** W1: the picker lists Wallet Standard wallets only, on every cluster, and helps users get one. */
afterEach(cleanup);

function state(overrides: Partial<WalletState>): WalletState {
  return { ...idleWallet, status: "disconnected", ...overrides };
}

const PHANTOM = { name: "Phantom", icon: null, ready: true };
const NOT_INSTALLED = { name: "Ledger", icon: null, ready: false };

describe("WalletPicker (wallet-only login)", () => {
  it.each(["mainnet", "devnet"] as const)(
    "lists only installed Wallet Standard wallets on %s, with no email or embedded option",
    (cluster) => {
      const select = vi.fn();
      render(
        <WalletPicker
          open
          onOpenChange={() => {}}
          state={state({ cluster, options: [PHANTOM, NOT_INSTALLED], select })}
        />,
      );
      const list = screen.getByRole("list", { name: "Installed wallets" });
      const buttons = within(list).getAllByRole("button");
      expect(buttons.map((b) => b.textContent)).toEqual(["Phantom"]);
      buttons[0]!.click();
      expect(select).toHaveBeenCalledWith("Phantom");
      expect(document.body.textContent).not.toMatch(/email|embedded/i);
    },
  );

  it("links the install guides and states the SOL needed from the single constant (mainnet)", () => {
    render(
      <WalletPicker
        open
        onOpenChange={() => {}}
        state={state({ cluster: "mainnet", options: [] })}
      />,
    );
    expect(screen.getByText(/No Solana wallet was found/)).toBeTruthy();
    for (const guide of WALLET_INSTALL_GUIDES) {
      const link = screen.getByRole("link", { name: `Install ${guide.name}` });
      expect(link.getAttribute("href")).toBe(guide.href);
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      expect(link.getAttribute("rel")).toContain("noopener");
    }
    expect(WALLET_INSTALL_GUIDES.map((g) => g.name)).toEqual([
      "Phantom",
      "Solflare",
      "Backpack",
    ]);
    const note = screen.getByTestId("sol-needed").textContent ?? "";
    expect(note).toContain(`about ${NEW_STOCK_ACCOUNT_SOL} SOL`);
    expect(note).toContain("network fees");
  });

  it("on devnet, labels test tokens and shows no mainnet SOL figure", () => {
    render(
      <WalletPicker
        open
        onOpenChange={() => {}}
        state={state({ cluster: "devnet", options: [PHANTOM] })}
      />,
    );
    expect(screen.getByText(/Devnet: test tokens, no real value/)).toBeTruthy();
    expect(screen.queryByTestId("sol-needed")).toBeNull();
    expect(screen.getByRole("link", { name: "Install Phantom" })).toBeTruthy();
  });
});
