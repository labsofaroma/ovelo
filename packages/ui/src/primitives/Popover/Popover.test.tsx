import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "./Popover";

const Sample = () => (
  <Popover>
    <PopoverTrigger>Data source</PopoverTrigger>
    <PopoverContent>
      <PopoverTitle>Source</PopoverTitle>
      <PopoverDescription>
        Sample note about where data comes from.
      </PopoverDescription>
    </PopoverContent>
  </Popover>
);

describe("Popover", () => {
  it("opens from the keyboard and reflects expanded state", async () => {
    const user = userEvent.setup();
    render(<Sample />);
    const trigger = screen.getByRole("button", { name: "Data source" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Source")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
  it("closes on Escape, returns focus, and passes axe while open", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<Sample />);
    const trigger = screen.getByRole("button", { name: "Data source" });
    await user.click(trigger);
    await screen.findByText("Source");
    expect(await axe(baseElement)).toHaveNoViolations();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Source")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
