import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("is a labelled status by default", async () => {
    const { container } = render(<Spinner />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
  it("can be silent when a parent announces busy, and uses the token animation", () => {
    const { container } = render(<Spinner label={null} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild).toHaveClass("animate-spin-token");
  });
});
