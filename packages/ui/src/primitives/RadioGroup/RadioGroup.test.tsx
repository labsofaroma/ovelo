import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../../test/axe";
import { RadioGroup, RadioGroupItem } from "./RadioGroup";

function Sample({ onValueChange }: { onValueChange?: (v: unknown) => void }) {
  return (
    <RadioGroup
      aria-label="Trading mode"
      defaultValue="paper"
      onValueChange={onValueChange}
    >
      <RadioGroupItem value="mainnet" label="Mainnet spot" />
      <RadioGroupItem value="paper" label="Paper practice" />
      <RadioGroupItem value="devnet" label="Devnet recurring" disabled />
    </RadioGroup>
  );
}

describe("RadioGroup", () => {
  it("exposes radiogroup/radio roles and checked state", async () => {
    const { container } = render(<Sample />);
    expect(
      screen.getByRole("radiogroup", { name: "Trading mode" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Paper practice" })).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
  });
  it("moves and selects with arrow keys, skipping disabled", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(<Sample onValueChange={onValueChange} />);
    await user.tab();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("radio", { name: "Mainnet spot" })).toBeChecked();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(
      screen.getByRole("radio", { name: "Devnet recurring" }),
    ).not.toBeChecked();
    expect(onValueChange).toHaveBeenCalled();
  });
});
