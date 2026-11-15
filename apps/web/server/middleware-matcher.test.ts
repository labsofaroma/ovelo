import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { config } from "@/middleware";

/**
 * Phase H: public/ folders skip middleware (no origin lock, no CSP) because they hold only
 * public, read-only files the image optimizer fetches through the app. A new top-level entry
 * must be classified here, so nothing new skips the gates by accident.
 */
const SKIPPED = [
  "images",
  "fonts",
  "company-logos",
  "token-logos",
  "xstocks-devnet",
];
/** Served through middleware (the service worker gets the CSP and the origin lock). */
const MATCHED = ["notify-sw.js"];

const matcher = new RegExp(`^${config.matcher[0]!.replace("/(", "/(")}$`);
const matched = (path: string) => matcher.test(path);

describe("middleware matcher", () => {
  it("classifies every top-level public/ entry", () => {
    const entries = readdirSync(
      join(import.meta.dirname, "..", "public"),
    ).sort();
    expect(entries).toEqual([...SKIPPED, ...MATCHED].sort());
  });

  it("skips exactly the public asset folders and _next/static", () => {
    for (const dir of SKIPPED)
      expect(matched(`/${dir}/a.png`), dir).toBe(false);
    expect(matched("/_next/static/chunks/a.js")).toBe(false);
    for (const path of [
      "/",
      "/markets",
      "/api/v1/trade/quote",
      "/_next/image",
      "/actions.json",
      "/og.png",
      "/robots.txt",
      "/notify-sw.js",
      // A page that merely starts like a skipped folder is still matched.
      "/images-gallery",
    ])
      expect(matched(path), path).toBe(true);
  });
});
