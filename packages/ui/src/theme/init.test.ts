import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, themeInitScript } from "./init";

function run(): void {
  new Function(themeInitScript)();
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

describe("themeInitScript", () => {
  it("always applies the dark theme, whatever was stored", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    run();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("clears the old toggle's stored choice", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    run();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run).not.toThrow();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
