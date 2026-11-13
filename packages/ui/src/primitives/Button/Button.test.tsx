import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "../../test/axe";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a type=button by default and forwards its ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Buy</Button>);
    expect(ref.current).toBe(screen.getByRole("button", { name: "Buy" }));
    expect(ref.current).toHaveAttribute("type", "button");
  });

  it("activates with click, Enter and Space", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("does nothing and leaves the tab order when disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    await user.click(screen.getByRole("button"));
    await user.tab();
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).not.toHaveFocus();
  });

  it("loading blocks activation but stays focusable and announces busy", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies variants and size, and has no axe violations", async () => {
    const { container } = render(
      <div>
        <Button variant="secondary">A</Button>
        <Button variant="ghost" size="sm">
          B
        </Button>
        <Button variant="danger" fullWidth>
          C
        </Button>
      </div>,
    );
    expect(screen.getByText("C")).toHaveClass("w-full");
    expect(await axe(container)).toHaveNoViolations();
  });
});
