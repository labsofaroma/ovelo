import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("is decorative, forwards ref and merges classes", async () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <div aria-busy="true">
        <Skeleton ref={ref} className="h-10" />
      </div>,
    );
    expect(ref.current).toHaveAttribute("aria-hidden", "true");
    expect(ref.current).toHaveClass("h-10", "animate-shimmer");
    expect(await axe(container)).toHaveNoViolations();
  });
});
