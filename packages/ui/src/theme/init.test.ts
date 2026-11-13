import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, themeInitScript } from "./init";

function run(): void {
  new Function(themeInitScript)();
}
function stubSystemDark(dark: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: dark && query.includes("dark"),
        media: query,
      }) as MediaQueryList,
  );
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

describe("themeInitScript", () => {
  it("applies a stored light/dark choice before anything else", () => {
    stubSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    run();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("falls back to prefers-color-scheme, then to light", () => {
    stubSystemDark(true);
    run();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    stubSystemDark(false);
    run();
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("ignores junk in storage and survives a throwing localStorage", () => {
    stubSystemDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, "<script>");
    run();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run).not.toThrow();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("is a single self-contained expression safe to inline in <head>", () => {
    expect(themeInitScript).not.toMatch(/<\/script>/i);
    expect(themeInitScript.length).toBeLessThan(700);
  });
});
