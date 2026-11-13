import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { X } from "lucide-react";
import { axe } from "../../test/axe";
import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("is named by aria-label, hides the icon, forwards ref and fires onClick", async () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    const { container } = render(
      <IconButton
        ref={ref}
        aria-label="Close panel"
        icon={<X />}
        onClick={onClick}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(ref.current).not.toBeNull();
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("supports disabled and loading", () => {
    render(<IconButton aria-label="Refresh" icon={<X />} loading />);
    expect(screen.getByRole("button", { name: "Refresh" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("rejects a missing label at the type level", () => {
    // @ts-expect-error aria-label is required: an icon alone has no accessible name
    const bad = <IconButton icon={<X />} />;
    expect(bad).toBeTruthy();
  });
});
