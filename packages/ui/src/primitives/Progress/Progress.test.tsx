import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Progress } from "./Progress";

describe("Progress", () => {
  it("exposes a determinate value", async () => {
    const { container } = render(
      <Progress label="Plan funded" value={40} showValue />,
    );
    const bar = screen.getByRole("progressbar", { name: "Plan funded" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(await axe(container)).toHaveNoViolations();
  });
  it("is indeterminate without a value attribute", async () => {
    const { container } = render(
      <Progress aria-label="Confirming" value={null} />,
    );
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(
      container.querySelector(".animate-indeterminate"),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
