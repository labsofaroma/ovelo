import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4 decision 2: v1 HTML is dynamic. The nonce CSP needs a nonce per request; a prerendered (ISR or
 * static) page carries none, so the browser blocks its scripts and islands never hydrate. Today
 * the (app) and (marketing) root layouts call `headers()`, which also forces dynamic rendering,
 * but a segment export must never rely on that (M5b A1: `/basket/new` had `revalidate = 120`).
 */
const WEB = join(__dirname, "../..");
const ROOTS = ["app/(app)/(shell)", "app/(marketing)/(site)", "app/api/v1"];
/** Images carry no script; the OG image is generated once and has no market figures (M3 decision 8). */
const ALLOWED_STATIC = new Set(["app/(marketing)/(site)/og.png/route.tsx"]);
const FORBIDDEN = [
  /export\s+const\s+revalidate\s*=/,
  /export\s+(async\s+)?function\s+generateStaticParams/,
  /export\s+const\s+generateStaticParams/,
  /["']force-static["']/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

describe("v1 pages and routes are dynamic (nonce CSP)", () => {
  const all = ROOTS.flatMap((root) => files(join(WEB, root)));

  it("finds the v1 pages, including the builder", () => {
    const names = all.map((path) => relative(WEB, path));
    expect(names).toContain("app/(app)/(shell)/basket/new/page.tsx");
    expect(names).toContain("app/(app)/(shell)/creators/page.tsx");
  });

  it.each(
    all
      .map((path) => relative(WEB, path))
      .filter((path) => !ALLOWED_STATIC.has(path)),
  )("%s has no ISR or static export", (path) => {
    const text = readFileSync(join(WEB, path), "utf8");
    for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
  });

  it("the builder opts into dynamic rendering explicitly", () => {
    const text = readFileSync(
      join(WEB, "app/(app)/(shell)/basket/new/page.tsx"),
      "utf8",
    );
    expect(text).toMatch(/export const dynamic = "force-dynamic"/);
  });
});
