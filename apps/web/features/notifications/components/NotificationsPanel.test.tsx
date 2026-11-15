// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsCopy } from "../copy";
import type { SubscriptionView } from "../schema";
import { NotificationsPanel } from "./NotificationsPanel";

afterEach(cleanup);
const WALLET = "7e5pxK83ceXb2iWXBizF1U8MdL7C5VcVBBXpDWaYo3x1";
const actions = () => ({
  open: vi.fn(),
  turnOn: vi.fn(),
  refresh: vi.fn(),
  saveEvents: vi.fn(),
  test: vi.fn(),
  turnOff: vi.fn(),
  deleteAll: vi.fn(),
});
const state = (over: Record<string, unknown> = {}) => ({
  config: {
    data: {
      enabled: true,
      push: { publicKey: "PUB" },
      telegram: { bot: "ovelo_bot" },
    },
    isPending: false,
    isError: false,
  },
  open: false,
  subscriptions: [] as SubscriptionView[],
  telegramLink: null,
  busy: null,
  error: null,
  notice: null,
  actions: actions(),
  ...over,
});

describe("NotificationsPanel", () => {
  it("off on this deployment: says so, offers nothing", () => {
    render(
      <NotificationsPanel
        wallet={WALLET}
        canSign
        state={state({
          config: {
            data: { enabled: false, push: null, telegram: null },
            isPending: false,
            isError: false,
          },
        })}
      />,
    );
    expect(screen.getByText(settingsCopy.disabled)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("no channel configured, no wallet, or a wallet that cannot sign: an honest line each", () => {
    const none = {
      data: { enabled: true, push: null, telegram: null },
      isPending: false,
      isError: false,
    };
    const { rerender } = render(
      <NotificationsPanel
        wallet={WALLET}
        canSign
        state={state({ config: none })}
      />,
    );
    expect(screen.getByText(settingsCopy.noChannels)).toBeTruthy();
    rerender(<NotificationsPanel wallet={null} canSign state={state()} />);
    expect(screen.getByText(settingsCopy.connectFirst)).toBeTruthy();
    rerender(
      <NotificationsPanel wallet={WALLET} canSign={false} state={state()} />,
    );
    expect(screen.getByText(settingsCopy.cannotSign)).toBeTruthy();
  });

  it("closed: one button that asks for the wallet's signature", () => {
    const s = state();
    render(<NotificationsPanel wallet={WALLET} canSign state={s} />);
    fireEvent.click(screen.getByRole("button", { name: settingsCopy.open }));
    expect(s.actions.open).toHaveBeenCalledOnce();
  });

  it("open: every configured channel, off by default; turning one on sends the chosen events", () => {
    const s = state({ open: true });
    render(<NotificationsPanel wallet={WALLET} canSign state={s} />);
    expect(screen.getByRole("region", { name: "Browser push" })).toBeTruthy();
    const telegram = screen.getByRole("region", { name: "Telegram" });
    expect(telegram.textContent).toContain("Off");
    fireEvent.click(
      screen.getAllByRole("button", { name: settingsCopy.turnOn })[1]!,
    );
    expect(s.actions.turnOn).toHaveBeenCalledWith("telegram", [
      "trade_confirmed",
      "trade_failed",
      "trade_unconfirmed",
    ]);
  });

  it("a pending Telegram link shows the one-time link; an active channel offers test and off", () => {
    const subscriptions: SubscriptionView[] = [
      {
        channel: "telegram",
        status: "pending",
        events: ["trade_confirmed"],
        createdAt: "x",
        verifiedAt: null,
      },
      {
        channel: "push",
        status: "active",
        events: ["plan_round_failed"],
        createdAt: "x",
        verifiedAt: "y",
      },
    ];
    const s = state({
      open: true,
      subscriptions,
      telegramLink: "https://t.me/ovelo_bot?start=abc",
    });
    render(<NotificationsPanel wallet={WALLET} canSign state={s} />);
    expect(
      screen
        .getByRole("link", { name: settingsCopy.telegramOpen })
        .getAttribute("href"),
    ).toBe("https://t.me/ovelo_bot?start=abc");
    fireEvent.click(screen.getByRole("button", { name: settingsCopy.test }));
    expect(s.actions.test).toHaveBeenCalledWith("push");
    fireEvent.click(
      screen.getByRole("button", { name: settingsCopy.deleteAll }),
    );
    expect(s.actions.deleteAll).toHaveBeenCalledOnce();
  });

  it("errors are announced", () => {
    render(
      <NotificationsPanel
        wallet={WALLET}
        canSign
        state={state({ error: "Nope" })}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Nope");
  });
});
