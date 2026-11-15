// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { routes } from "../routes";
import { RouteError } from "./RouteError";

afterEach(cleanup);

const props = { error: new Error("boom"), reset: () => {} };

describe("RouteError escape link", () => {
  it("defaults to markets", () => {
    render(<RouteError {...props} />);
    expect(
      screen.getByRole("link", { name: "Go to markets" }).getAttribute("href"),
    ).toBe(routes.markets);
  });

  it("can point elsewhere, so the markets error page does not link to itself", () => {
    render(
      <RouteError
        {...props}
        title="Markets could not be loaded"
        escape={{ href: routes.home, label: "Go to the home page" }}
      />,
    );
    expect(screen.queryByRole("link", { name: "Go to markets" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Go to the home page" })
        .getAttribute("href"),
    ).toBe(routes.home);
  });
});
