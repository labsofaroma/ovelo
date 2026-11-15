// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../../shared/routes";
import { Landing } from "./Landing";

afterEach(cleanup);

/** Internal routes plus the landing's own in-page anchor ("How it works"). */
const internal = new Set<string>([
  ...Object.values(routes).filter((r) => typeof r === "string"),
  "#how-it-works",
]);

describe("Landing links and button texts", () => {
  it("does not say spot trading is still coming (it is live since M9)", () => {
    render(<Landing />);
    expect(document.body.textContent).not.toMatch(/Coming to this preview/);
  });

  it("has distinct call-to-action texts and only internal, named links", () => {
    render(<Landing />);
    const links = screen.getAllByRole("link");
    const texts = links.map((a) => a.textContent?.trim() ?? "");
    expect(texts).toContain("Explore markets");
    expect(texts).toContain("Start with paper practice");
    expect(texts).toContain("Launch app");
    expect(texts).not.toContain("Open markets");
    for (const link of links) {
      expect(link.textContent?.trim()).not.toBe("");
      expect(internal.has(link.getAttribute("href") ?? "")).toBe(true);
    }
  });
});
