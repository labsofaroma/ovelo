import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";

const Sample = () => (
  <Dialog>
    <DialogTrigger>Open dialog</DialogTrigger>
    <DialogContent>
      <DialogTitle>Close plan?</DialogTitle>
      <DialogDescription>This revokes the approval.</DialogDescription>
      <DialogFooter>
        <button type="button">Confirm</button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

describe("Dialog", () => {
  it("opens as a modal named by its title, then closes with Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<Sample />);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Close plan?" });
    expect(dialog).toHaveAccessibleDescription("This revokes the approval.");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("moves focus into the dialog on open and exposes a labelled close button", async () => {
    // The Tab-cycle focus trap needs a real browser; it is asserted in e2e/keyboard.spec.ts.
    const user = userEvent.setup();
    render(<Sample />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<Sample />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await screen.findByRole("dialog");
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
