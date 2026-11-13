// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mint } from "../../test/fixtures";
import { useWatchlist } from "../store";
import { WatchToggle } from "./WatchToggle";

beforeEach(() => {
  // Reset first: a store write persists, so storage is cleared after it.
  useWatchlist.setState({ mints: [], hydrated: false });
  window.localStorage.clear();
});
afterEach(cleanup);

describe("WatchToggle", () => {
  it("is disabled until saved picks load, then toggles with aria-pressed", async () => {
    render(<WatchToggle mint={mint(1)} symbol="TESTx" />);
    const button = screen.getByRole("button", { name: "Watch TESTx" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(useWatchlist.getState().mints).toEqual([mint(1)]);
  });

  it("keeps one accessible name in both states (visible label included)", async () => {
    render(<WatchToggle mint={mint(2)} symbol="DOWNx" showLabel />);
    const button = screen.getByRole("button", { name: "Watch DOWNx" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    expect(button.textContent).toContain("Watch");
    await act(() => userEvent.click(button));
    expect(screen.getByRole("button", { name: "Watch DOWNx" })).toBe(button);
  });
});
