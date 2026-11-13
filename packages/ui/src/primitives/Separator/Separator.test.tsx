import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Separator } from "./Separator";

describe("Separator", () => {
  it("exposes separator role and orientation", async () => {
    const { container } = render(
      <div>
        <Separator />
        <Separator orientation="vertical" />
      </div>,
    );
    const [h, v] = screen.getAllByRole("separator");
    expect(h).toHaveAttribute("aria-orientation", "horizontal");
    expect(v).toHaveAttribute("aria-orientation", "vertical");
    expect(await axe(container)).toHaveNoViolations();
  });
});
