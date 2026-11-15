// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWallet } from "./context";
import {
  devnetConfig,
  DEVNET_GENESIS,
  mainnetConfig,
  MAINNET_GENESIS,
} from "./cluster";
import E2EStack from "./stack/E2EStack";
import { ClusterLabel } from "./ClusterLabel";

const ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

function Probe() {
  const wallet = useWallet();
  return (
    <p data-testid="probe">
      {wallet.cluster}|{wallet.status}|{wallet.signer?.cluster ?? "none"}|
      {wallet.error ?? ""}
    </p>
  );
}

function rpcGenesis(genesis: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ result: genesis })),
  );
}

function bridge(chains?: string[]) {
  (window as unknown as { oveloE2EWallet: unknown }).oveloE2EWallet = {
    address: ADDRESS,
    chains,
    sign: async (unsigned: string[]) => unsigned,
  };
}

beforeEach(() => {
  delete (window as unknown as { oveloE2EWallet?: unknown }).oveloE2EWallet;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("E2E wallet honours the boundary's cluster (M7 B2)", () => {
  it("connects on devnet with a devnet RPC and a devnet account; the signer is devnet's", async () => {
    rpcGenesis(DEVNET_GENESIS);
    bridge(["solana:devnet"]);
    render(
      <E2EStack initiallyOpen cluster={devnetConfig()}>
        <Probe />
      </E2EStack>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe(
        "devnet|connected|devnet|",
      ),
    );
  });

  it("refuses a devnet page whose browser RPC is mainnet", async () => {
    rpcGenesis(MAINNET_GENESIS);
    bridge();
    render(
      <E2EStack initiallyOpen cluster={devnetConfig()}>
        <Probe />
      </E2EStack>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toMatch(
        /^devnet\|wrong-network\|none\|Recurring investing runs on Solana devnet only/,
      ),
    );
  });

  it("refuses a mainnet-only account on devnet", async () => {
    rpcGenesis(DEVNET_GENESIS);
    bridge(["solana:mainnet"]);
    render(
      <E2EStack initiallyOpen cluster={devnetConfig()}>
        <Probe />
      </E2EStack>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toMatch(
        /^devnet\|wrong-network\|none\|/,
      ),
    );
  });

  it("refuses a devnet-only account on a mainnet page", async () => {
    bridge(["solana:devnet"]);
    render(
      <E2EStack initiallyOpen cluster={mainnetConfig()}>
        <Probe />
      </E2EStack>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toMatch(
        /^mainnet\|wrong-network\|none\|Ovelo trades on Solana mainnet only/,
      ),
    );
  });

  it("a mainnet signer stays mainnet's and never appears as devnet", async () => {
    bridge();
    render(
      <E2EStack initiallyOpen cluster={mainnetConfig()}>
        <Probe />
      </E2EStack>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toBe(
        "mainnet|connected|mainnet|",
      ),
    );
  });

  it("disconnect clears the signer", async () => {
    rpcGenesis(DEVNET_GENESIS);
    bridge();
    let api: ReturnType<typeof useWallet> | null = null;
    function Grab() {
      api = useWallet();
      return null;
    }
    render(
      <E2EStack initiallyOpen cluster={devnetConfig()}>
        <Grab />
        <Probe />
      </E2EStack>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("probe").textContent).toMatch(/connected/),
    );
    act(() => api!.disconnect());
    expect(screen.getByTestId("probe").textContent).toBe(
      "devnet|disconnected|none|",
    );
  });

  it("the devnet label is visible; mainnet renders none", () => {
    const { container } = render(<ClusterLabel cluster="devnet" />);
    expect(screen.getByText("Devnet: test tokens, no real value")).toBeTruthy();
    cleanup();
    render(<ClusterLabel cluster="mainnet" />);
    expect(container.textContent).toBe("");
  });
});
