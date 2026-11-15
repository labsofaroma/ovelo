import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { SocialLinks } from "./SocialLinks";

describe("SocialLinks", () => {
  it("renders a labelled nav of safe external links", async () => {
    const { container } = render(<SocialLinks />);
    expect(
      screen.getByRole("navigation", { name: "Ovelo community" }),
    ).toBeInTheDocument();
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
      expect(link).toHaveAccessibleName(/opens in a new tab/);
      // WCAG 2.5.3 Label in Name: the accessible name contains the visible text.
      expect(link.getAttribute("aria-label")).toBeNull();
      expect(link.textContent).toContain(
        link.querySelector("span")?.firstChild?.textContent ?? "?",
      );
    }
    expect(await axe(container)).toHaveNoViolations();
  });
  it("accepts custom links", () => {
    render(
      <SocialLinks
        links={[
          {
            href: "https://example.invalid",
            label: "Docs",
            iconPath: "M0 0h24v24H0z",
          },
        ]}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
