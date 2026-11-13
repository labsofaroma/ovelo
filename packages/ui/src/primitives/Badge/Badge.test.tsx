import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its text with a tone and forwards ref", async () => {
    const ref = createRef<HTMLSpanElement>();
    const { container } = render(
      <div>
        <Badge ref={ref} tone="warning">
          Devnet only
        </Badge>
        <Badge tone="up">Mainnet</Badge>
        <Badge>Paper</Badge>
      </div>,
    );
    expect(screen.getByText("Devnet only")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(ref.current).toBe(screen.getByText("Devnet only"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
