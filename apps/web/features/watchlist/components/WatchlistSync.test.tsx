// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mint } from "../../test/fixtures";
import { useWatchlist, WATCHLIST_KEY } from "../store";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/watchlist",
}));

const { WatchlistSync } = await import("./WatchlistSync");

const save = (mints: string[]) =>
  window.localStorage.setItem(
    WATCHLIST_KEY,
    JSON.stringify({ state: { mints }, version: 1 }),
  );

beforeEach(() => {
  // Reset first: a store write persists, so storage is cleared after it.
  useWatchlist.setState({ mints: [], hydrated: false });
  window.localStorage.clear();
});
afterEach(cleanup);

describe("WatchlistSync", () => {
  it("mirrors saved mints into ?m= so the server renders them", async () => {
    save([mint(1), mint(2)]);
    render(
      <WatchlistSync renderedMints={[]}>
        <p>table</p>
      </WatchlistSync>,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Loading your watchlist",
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/watchlist?m=${mint(1)},${mint(2)}`,
        {
          scroll: false,
        },
      ),
    );
    expect(screen.queryByText("table")).toBeNull();
  });

  it("shows the server-rendered rows once in sync", async () => {
    save([mint(1)]);
    render(
      <WatchlistSync renderedMints={[mint(1)]}>
        <p>table</p>
      </WatchlistSync>,
    );
    await screen.findByText("table");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("explains the empty state", async () => {
    render(
      <WatchlistSync renderedMints={[]}>
        <p>table</p>
      </WatchlistSync>,
    );
    await screen.findByText("Your watchlist is empty.");
  });
});
