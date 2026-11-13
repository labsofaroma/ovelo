import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../../test/axe";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";

const Sample = ({ onSelect }: { onSelect?: () => void }) => (
  <DropdownMenu>
    <DropdownMenuTrigger>Account</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={onSelect}>Portfolio</DropdownMenuItem>
        <DropdownMenuItem disabled>Activity</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Sign out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

describe("DropdownMenu", () => {
  it("opens with Enter onto the first item, navigates with arrows, selects with Enter", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Sample onSelect={onSelect} />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Portfolio" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Activity" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Portfolio" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
  it("closes on Escape, returns focus, marks disabled items, passes axe", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<Sample />);
    const trigger = screen.getByRole("button", { name: "Account" });
    await user.click(trigger);
    await screen.findByRole("menu");
    expect(screen.getByRole("menuitem", { name: "Activity" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(await axe(baseElement)).toHaveNoViolations();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});
