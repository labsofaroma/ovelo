// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../routes";
import { NotFound } from "./NotFound";

afterEach(cleanup);

describe("NotFound (global 404 body)", () => {
  it("is one main landmark with one h1 and links back into v1", () => {
    render(<NotFound />);
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Page not found",
    );
    expect(
      screen.getByRole("link", { name: "Browse markets" }).getAttribute("href"),
    ).toBe(routes.markets);
    expect(
      screen.getByRole("link", { name: "Ovelo home" }).getAttribute("href"),
    ).toBe(routes.home);
  });
});
