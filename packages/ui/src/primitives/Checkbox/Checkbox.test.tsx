import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../../test/axe";
import { Checkbox } from "./Checkbox";

describe("Checkbox", () => {
  it("toggles with Space and click, exposing aria-checked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <Checkbox label="Accept terms" onCheckedChange={onChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "Accept terms" });
    expect(box).toHaveAttribute("aria-checked", "false");
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard(" ");
    expect(box).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByText("Accept terms"));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(await axe(container)).toHaveNoViolations();
  });
  it("supports indeterminate and disabled and forwards ref", async () => {
    const ref = createRef<HTMLElement>();
    const { container } = render(
      <div>
        <Checkbox ref={ref} aria-label="Select all" indeterminate />
        <Checkbox label="Off" disabled />
      </div>,
    );
    expect(
      screen.getByRole("checkbox", { name: "Select all" }),
    ).toHaveAttribute("aria-checked", "mixed");
    expect(screen.getByRole("checkbox", { name: "Off" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(ref.current).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});
