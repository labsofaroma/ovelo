import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./Tooltip";

const Sample = () => (
  <TooltipProvider delay={0}>
    <Tooltip>
      <TooltipTrigger aria-label="More info">i</TooltipTrigger>
      <TooltipContent>Prices are delayed.</TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

describe("Tooltip", () => {
  it("shows on keyboard focus and hides on Escape", async () => {
    const user = userEvent.setup();
    render(<Sample />);
    await user.tab();
    expect(await screen.findByText("Prices are delayed.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByText("Prices are delayed.")).toBeNull(),
    );
  });
  it("shows on hover with the tooltip role and passes axe", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<Sample />);
    await user.hover(screen.getByRole("button", { name: "More info" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Prices are delayed.",
    );
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
