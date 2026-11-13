import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Change } from "./Change";

const pct = (value: bigint, decimals = 2) => ({ value, decimals });

describe("Change", () => {
  it("shows an up change with arrow, plus sign and screen-reader text", () => {
    const { container } = render(<Change percent={pct(123n)} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("data-direction", "up");
    expect(root).toHaveTextContent("Up +1.23%");
    expect(root.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows a down change with a minus sign and the word Down", () => {
    const { container } = render(<Change percent={pct(-250n)} />);
    expect(container.firstElementChild).toHaveAttribute(
      "data-direction",
      "down",
    );
    expect(container).toHaveTextContent("Down −2.50%");
  });

  it("treats zero and negative zero as flat, with no sign", () => {
    for (const value of [0n, -1n]) {
      const { container, unmount } = render(<Change percent={pct(value, 6)} />);
      expect(container.firstElementChild).toHaveAttribute(
        "data-direction",
        "flat",
      );
      expect(container).toHaveTextContent("No change 0.00%");
      expect(container.textContent).not.toMatch(/[+−-]\d/);
      unmount();
    }
  });

  it("renders an honest unavailable state for missing data", () => {
    const { container } = render(<Change percent={null} />);
    expect(container.firstElementChild).toHaveAttribute(
      "data-direction",
      "unavailable",
    );
    expect(container).toHaveTextContent("Change unavailable");
  });

  it("handles very large and very small values exactly", () => {
    const { container, rerender } = render(
      <Change percent={pct(99_999_999_999_999_999_999_949n, 4)} />,
    );
    expect(container).toHaveTextContent("+9,999,999,999,999,999,999.99%");
    rerender(<Change percent={pct(1n, 18)} />);
    expect(container.firstElementChild).toHaveAttribute(
      "data-direction",
      "flat",
    );
    rerender(<Change percent={pct(1n, 18)} percentDigits={18} />);
    expect(container).toHaveTextContent("+0.000000000000000001%");
  });

  it("shows an amount alongside the percent, and leads with the amount when alone", () => {
    const { container, rerender } = render(
      <Change
        percent={pct(-52n)}
        amount={{ value: -1_250_000n, decimals: 6, symbol: "$" }}
      />,
    );
    expect(container).toHaveTextContent("Down −0.52% (−$1.25)");
    rerender(
      <Change amount={{ value: 3_500_000n, decimals: 6, symbol: "$" }} />,
    );
    expect(container).toHaveTextContent("Up +$3.50");
  });

  it("is not conveyed by color alone and passes axe", async () => {
    const { container } = render(
      <div>
        <Change percent={pct(5n)} />
        <Change percent={pct(-5n)} />
        <Change percent={null} />
      </div>,
    );
    expect(
      screen.getAllByText(/^(Up|Down|Change unavailable)\s*$/),
    ).toHaveLength(3);
    expect(await axe(container)).toHaveNoViolations();
  });
});
