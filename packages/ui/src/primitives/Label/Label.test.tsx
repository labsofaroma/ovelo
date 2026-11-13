import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Label } from "./Label";

describe("Label", () => {
  it("labels a control, and focusing via the label works", async () => {
    const { container } = render(
      <div>
        <Label htmlFor="n" required>
          Name
        </Label>
        <input id="n" required />
      </div>,
    );
    await userEvent.setup().click(screen.getByText("Name"));
    expect(screen.getByLabelText(/Name/)).toHaveFocus();
    expect(container.querySelector("[aria-hidden='true']")).toHaveTextContent(
      "*",
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
