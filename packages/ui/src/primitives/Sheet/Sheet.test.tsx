import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "./Sheet";

const Sample = ({ side }: { side?: "left" | "right" | "bottom" }) => (
  <Sheet>
    <SheetTrigger>Open filters</SheetTrigger>
    <SheetContent side={side}>
      <SheetTitle>Filters</SheetTitle>
      <SheetDescription>Narrow the market list.</SheetDescription>
    </SheetContent>
  </Sheet>
);

describe("Sheet", () => {
  it("opens as a modal dialog, closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(<Sample />);
    const trigger = screen.getByRole("button", { name: "Open filters" });
    await user.click(trigger);
    expect(
      await screen.findByRole("dialog", { name: "Filters" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });
  it("anchors to the requested side and passes axe", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<Sample side="bottom" />);
    await user.click(screen.getByRole("button", { name: "Open filters" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("bottom-0");
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
