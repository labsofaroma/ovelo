import { render, screen } from "@testing-library/react";
import { createRef, forwardRef, type AnchorHTMLAttributes } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { OveloGlyph, Brand } from "./Brand";

describe("Brand", () => {
  it("links home with an accessible name and forwards ref", async () => {
    const ref = createRef<HTMLAnchorElement>();
    const { container } = render(<Brand ref={ref} />);
    const link = screen.getByRole("link", { name: "Ovelo home" });
    expect(link).toHaveAttribute("href", "/");
    expect(ref.current).toBe(link);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders each lockup variant", () => {
    const { container, rerender } = render(<Brand variant="glyph" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container).not.toHaveTextContent("ovelo");
    rerender(<Brand variant="wordmark" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container).toHaveTextContent("ovelo");
    rerender(<Brand variant="stacked" />);
    expect(container.firstElementChild).toHaveClass("flex-col");
  });

  it("accepts an injected router link and a static (unlinked) mode", async () => {
    const Router = forwardRef<
      HTMLAnchorElement,
      AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
    >(function Router(props, ref) {
      return <a ref={ref} data-router="yes" {...props} />;
    });
    const { container, rerender } = render(
      <Brand LinkComponent={Router} href="/app" />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("data-router", "yes");
    rerender(<Brand asStatic />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("img", { name: "Ovelo" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("takes a custom mark and keeps decorative art hidden from assistive tech", () => {
    const { container } = render(
      <div>
        <OveloGlyph />
        <Brand mark={<span data-testid="custom-mark" />} />
      </div>,
    );
    expect(screen.getByTestId("custom-mark")).toBeInTheDocument();
    for (const svg of container.querySelectorAll("svg"))
      expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
