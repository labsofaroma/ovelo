// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Signer } from "../../wallet/context";
import { TradeComplianceGate } from "./TradeComplianceGate";

/** M9: the ticket shows an honest blocked state, then the terms step, before any mainnet quote. */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WALLET = "4Nd1mYQzvgp7uVDYiHn9wrpTkMtZpZyV9pR9ZJ2q5vPz";
const signer = (signMessage: Signer["signMessage"]): Signer => ({
  address: WALLET,
  kind: "e2e",
  cluster: "mainnet",
  supportedTransactionVersions: [0],
  signTransactions: async () => [],
  signMessage,
});
const status = (over: Record<string, unknown>) => ({
  jurisdiction: "allowed",
  trade: true,
  browse: true,
  terms: { version: "v", hash: "h", final: false, accepted: false },
  ...over,
});

function renderGate(s: Signer | null, live = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TradeComplianceGate live={live} signer={s}>
        <button type="button">Get quote</button>
      </TradeComplianceGate>
    </QueryClientProvider>,
  );
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  // Phase A: the beta gate is off here (its own states: features/beta/components tests).
  const fetch = vi.fn(async (url: string, init?: RequestInit) =>
    Response.json(
      url.startsWith("/api/v1/beta/status")
        ? { gate: false, access: true }
        : handler(url, init),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("TradeComplianceGate", () => {
  it("a restricted location sees the notice, not the quote button", async () => {
    mockFetch(() => status({ jurisdiction: "restricted", trade: false }));
    renderGate(signer(null));
    expect(
      await screen.findByText("Mainnet purchases are not available here"),
    ).toBeTruthy();
    expect(screen.getByText(/not identity verification/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get quote" })).toBeNull();
  });

  it("an unknown location says so (fail closed)", async () => {
    mockFetch(() => status({ jurisdiction: "unknown", trade: false }));
    renderGate(signer(null));
    expect(await screen.findByText(/could not be confirmed/)).toBeTruthy();
  });

  it("an allowed wallet without terms signs the challenge, then gets the quote button", async () => {
    let accepted = false;
    const fetch = mockFetch((url) => {
      if (url.includes("/terms/challenge"))
        return {
          nonce: "n".repeat(32),
          message: "Ovelo: sign",
          version: "v",
          hash: "h",
          expiresAt: "t",
        };
      if (url.includes("/terms/accept")) {
        accepted = true;
        return { accepted: true };
      }
      return status({
        terms: { version: "v", hash: "h", final: false, accepted },
      });
    });
    const signMessage = vi.fn(async (_message: Uint8Array) =>
      new Uint8Array(64).fill(7),
    );
    renderGate(signer(signMessage));
    expect(
      await screen.findByText("Placeholder terms: pending counsel"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get quote" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign to accept the terms" }),
    );
    expect(
      await screen.findByRole("button", { name: "Get quote" }),
    ).toBeTruthy();
    expect(new TextDecoder().decode(signMessage.mock.calls[0]![0])).toBe(
      "Ovelo: sign",
    );
    const acceptCall = fetch.mock.calls.find(([u]) =>
      u.includes("/terms/accept"),
    );
    expect(JSON.parse(String(acceptCall![1]!.body))).toEqual({
      wallet: WALLET,
      nonce: "n".repeat(32),
      signature: Buffer.from(new Uint8Array(64).fill(7)).toString("base64"),
      version: "v",
    });
  });

  it("a wallet that cannot sign messages is told so", async () => {
    mockFetch(() => status({}));
    renderGate(signer(null));
    expect(await screen.findByText(/cannot sign messages/)).toBeTruthy();
  });

  it("paper practice is never gated (no request is made)", async () => {
    const fetch = mockFetch(() => status({ trade: false }));
    renderGate(null, false);
    expect(screen.getByRole("button", { name: "Get quote" })).toBeTruthy();
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });
});
