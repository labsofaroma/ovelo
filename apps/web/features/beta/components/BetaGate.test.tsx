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
import { TradeComplianceGate } from "../../compliance/components/TradeComplianceGate";
import type { Signer } from "../../wallet/context";
import { BetaBanner } from "./BetaBanner";

/** W2 UI: an honest private-beta banner, and the redeem step before terms in the trade ticket. */
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
const compliance = (accepted: boolean) => ({
  jurisdiction: "allowed",
  trade: true,
  browse: true,
  terms: { version: "v", hash: "h", final: false, accepted },
});

function renderGate(s: Signer | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TradeComplianceGate live signer={s}>
        <button type="button">Get quote</button>
      </TradeComplianceGate>
    </QueryClientProvider>,
  );
}

describe("BetaBanner", () => {
  it("labels every page while the gate is on and disappears when it is off", () => {
    const { unmount } = render(<BetaBanner env={{ OVELO_BETA_GATE: "on" }} />);
    expect(
      screen.getByRole("complementary", { name: "Private beta" }).textContent,
    ).toMatch(/invited wallets only/);
    unmount();
    render(
      <BetaBanner env={{ OVELO_BETA_GATE: "off", NODE_ENV: "production" }} />,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("TradeComplianceGate with the beta gate on", () => {
  it("no access: the redeem step replaces the quote button; redeeming signs, then terms come next", async () => {
    let access = false;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url.startsWith("/api/v1/beta/status"))
          return Response.json({ gate: true, access });
        if (url === "/api/v1/beta/challenge") {
          expect(JSON.parse(String(init?.body))).toEqual({
            wallet: WALLET,
            code: "ovelo-beta-abcdefghijklmnop",
          });
          return Response.json({
            nonce: "n".repeat(32),
            message: "Ovelo: sign",
            expiresAt: "x",
          });
        }
        if (url === "/api/v1/beta/redeem") {
          access = true;
          return Response.json({ access: true, alreadyHadAccess: false });
        }
        return Response.json(compliance(false));
      }),
    );
    const signMessage = vi.fn(async () => new Uint8Array(64));
    renderGate(signer(signMessage));
    expect(
      await screen.findByRole("region", { name: "Private beta access" }),
    ).toBeTruthy();
    expect(screen.getByText("Private beta")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get quote" })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Accept the terms" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Invite code"), {
      target: { value: " ovelo-beta-abcdefghijklmnop " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Sign to redeem the invite" }),
    );
    await waitFor(() => expect(signMessage).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("region", { name: "Accept the terms" }),
    ).toBeTruthy();
    expect(calls).toContain("/api/v1/beta/redeem");
  });

  it("a refused code shows the server's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/v1/beta/status"))
          return Response.json({ gate: true, access: false });
        if (url === "/api/v1/beta/challenge")
          return Response.json({
            nonce: "n".repeat(32),
            message: "m",
            expiresAt: "x",
          });
        if (url === "/api/v1/beta/redeem")
          return Response.json(
            {
              code: "BETA_INVITE_INVALID",
              message:
                "This beta invite code is not valid, has expired or was already used.",
            },
            { status: 403 },
          );
        return Response.json(compliance(true));
      }),
    );
    renderGate(signer(async () => new Uint8Array(64)));
    fireEvent.change(await screen.findByLabelText("Invite code"), {
      target: { value: "ovelo-beta-abcdefghijklmnop" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Sign to redeem the invite" }),
    );
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /already used/,
    );
  });

  it("a wallet that cannot sign messages is told so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.startsWith("/api/v1/beta")
            ? { gate: true, access: false }
            : compliance(true),
        ),
      ),
    );
    renderGate(signer(null));
    expect(await screen.findByText(/cannot redeem an invite/)).toBeTruthy();
  });

  it("with access, the quote button shows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        Response.json(
          url.startsWith("/api/v1/beta")
            ? { gate: true, access: true }
            : compliance(true),
        ),
      ),
    );
    renderGate(signer(null));
    expect(
      await screen.findByRole("button", { name: "Get quote" }),
    ).toBeTruthy();
  });
});
