import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Input } from "./Input";

describe("Input", () => {
  it("accepts typing, forwards ref and supports disabled", async () => {
    const ref = createRef<HTMLInputElement>();
    const user = userEvent.setup();
    const { container, rerender } = render(
      <Input ref={ref} aria-label="Amount" />,
    );
    await user.type(screen.getByLabelText("Amount"), "12.5");
    expect(ref.current).toHaveValue("12.5");
    rerender(<Input aria-label="Amount" disabled />);
    expect(screen.getByLabelText("Amount")).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });
  it("marks itself invalid with aria-invalid", () => {
    render(<Input aria-label="Amount" invalid />);
    expect(screen.getByLabelText("Amount")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
