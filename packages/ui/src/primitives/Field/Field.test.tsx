import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Input } from "../Input";
import { Field } from "./Field";

describe("Field", () => {
  it("wires label, hint and control together", async () => {
    const { container } = render(
      <Field label="Wallet label" hint="Only you see this.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Wallet label");
    expect(input).toHaveAccessibleDescription("Only you see this.");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows an error, marks the control invalid and describes it", async () => {
    const { container } = render(
      <Field label="Amount" hint="USDC" error="Enter an amount above zero.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/Enter an amount above zero\./);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows a visible required marker without double-announcing it", () => {
    const { container } = render(
      <Field label="Name" required>
        <Input required />
      </Field>,
    );
    expect(container.querySelector("[aria-hidden='true']")).toHaveTextContent(
      "*",
    );
    expect(screen.getByLabelText(/Name/)).toBeRequired();
  });
});
