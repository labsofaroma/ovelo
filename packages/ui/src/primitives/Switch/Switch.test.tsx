import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("toggles with Space/Enter-free click and keyboard, role=switch", async () => {
    const user = userEvent.setup();
    const { container } = render(<Switch label="Price alerts" />);
    const sw = screen.getByRole("switch", { name: "Price alerts" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.tab();
    await user.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByText("Price alerts"));
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(await axe(container)).toHaveNoViolations();
  });
  it("respects disabled", async () => {
    render(<Switch label="Locked" disabled />);
    await userEvent.setup().click(screen.getByText("Locked"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });
});
