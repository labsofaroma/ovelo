// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssetAvatar } from "@ovelo/ui";
import { afterEach, describe, expect, it } from "vitest";
import { NextAvatarImage } from "./NextAvatarImage";

afterEach(cleanup);

const props = { alt: "Logo", width: 32, height: 32 };

describe("NextAvatarImage", () => {
  it("renders a logo on an unlisted host unoptimized instead of throwing", () => {
    expect(() =>
      render(<NextAvatarImage {...props} src="https://evil.example/a.png" />),
    ).not.toThrow();
    expect(screen.getByRole("img", { name: "Logo" }).getAttribute("src")).toBe(
      "https://evil.example/a.png",
    );
  });

  it("sends a listed host through the optimizer", () => {
    render(
      <NextAvatarImage
        {...props}
        src="https://static.datapi.jup.ag/token-icons/a.webp"
      />,
    );
    expect(
      screen.getByRole("img", { name: "Logo" }).getAttribute("src"),
    ).toMatch(/^\/_next\/image\?url=https%3A%2F%2Fstatic\.datapi\.jup\.ag/);
  });

  it("falls back to the ticker tile when the unlisted logo fails to load (CSP block)", () => {
    const { container } = render(
      <AssetAvatar
        asset={{
          symbol: "ZZZx",
          mint: "ZZZ1111111111111111111111111111111111111111",
          logoUrl: "https://evil.example/a.png",
        }}
        label="ZZZx logo"
        ImageComponent={NextAvatarImage}
      />,
    );
    const img = screen.getByRole("img", { name: "ZZZx logo" });
    expect(img.getAttribute("src")).toBe("https://evil.example/a.png");
    expect(container.firstElementChild?.hasAttribute("data-fallback")).toBe(
      false,
    );
    fireEvent.error(img);
    expect(container.firstElementChild?.hasAttribute("data-fallback")).toBe(
      true,
    );
  });
});
