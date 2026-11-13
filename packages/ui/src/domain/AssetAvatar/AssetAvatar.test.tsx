import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axe } from "../../test/axe";
import { AssetAvatar, type AvatarImageProps } from "./AssetAvatar";
import {
  fallbackTone,
  getCompanyLogo,
  hashSymbol,
  isSafeLogoUrl,
} from "./logo-lookup";

describe("AssetAvatar", () => {
  it("prefers the bundled issuer logo, resolved by mint", () => {
    const { container } = render(
      <AssetAvatar
        asset={{
          symbol: "AAPLx",
          mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
        }}
        label="Apple logo"
      />,
    );
    expect(screen.getByRole("img", { name: "Apple logo" })).toHaveAttribute(
      "src",
      "/company-logos/aapl.webp",
    );
    expect(container.firstElementChild).not.toHaveAttribute("data-fallback");
  });

  it("falls back to a ticker tile when there is no logo", async () => {
    const { container } = render(<AssetAvatar asset={{ symbol: "ZZZZ" }} />);
    expect(container.firstElementChild).toHaveAttribute("data-fallback");
    expect(container).toHaveTextContent("ZZZ");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("falls back when the image fails to load", () => {
    const { container } = render(
      <AssetAvatar
        asset={{ symbol: "ZZZZ", logoUrl: "https://example.invalid/x.png" }}
        label="Sample"
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Sample" }));
    expect(container.firstElementChild).toHaveAttribute("data-fallback");
    expect(container.querySelector("img")).toBeNull();
  });

  it("refuses unsafe URLs outright", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,AA",
      "//evil.example/x.png",
      "http://insecure.example/x.png",
    ]) {
      expect(isSafeLogoUrl(url)).toBe(false);
    }
    expect(isSafeLogoUrl("https://ok.example/x.png")).toBe(true);
    expect(isSafeLogoUrl("/company-logos/aapl.webp")).toBe(true);
    const { container } = render(
      <AssetAvatar
        asset={{ symbol: "ZZZZ", logoUrl: "javascript:alert(1)" }}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders through an injected image component (next/image mode)", () => {
    const Injected = ({ src, alt, width }: AvatarImageProps) => (
      <img data-injected="yes" src={src} alt={alt} width={width} />
    );
    render(
      <AssetAvatar
        asset={{ symbol: "AAPL" }}
        ImageComponent={Injected}
        label="Apple"
        size="lg"
      />,
    );
    expect(screen.getByRole("img", { name: "Apple" })).toHaveAttribute(
      "data-injected",
      "yes",
    );
    expect(screen.getByRole("img", { name: "Apple" })).toHaveAttribute(
      "width",
      "64",
    );
  });

  it("small size shows an accessible placeholder icon", () => {
    render(<AssetAvatar asset={{ symbol: "ZZZZ" }} size="sm" />);
    expect(
      screen.getByRole("img", { name: "Company logo unavailable" }),
    ).toBeInTheDocument();
  });
});

describe("logo lookup", () => {
  it("is deterministic and keeps unrelated mints from borrowing logos", () => {
    expect(hashSymbol("AAPL")).toBe(hashSymbol("AAPL"));
    expect(fallbackTone("tsla")).toBe(fallbackTone("TSLA"));
    expect(getCompanyLogo({ symbol: "AAPLx" })).toBe(
      "/company-logos/aapl.webp",
    );
    expect(getCompanyLogo({ symbol: "AAPL.US" })).toBe(
      "/company-logos/aapl.webp",
    );
    expect(
      getCompanyLogo({
        symbol: "NOPE",
        mint: "11111111111111111111111111111111",
      }),
    ).toBeNull();
  });
});
