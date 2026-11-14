import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The repo rules that applied to this code while it lived in `apps/web/lib/sdk` (sdk-rules),
 * plus the package boundary: nothing here may import from `apps/*`.
 */
const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|mjs)$/.test(name) ? [path] : [];
  });
}
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const files = [...sources(SRC), ...sources(join(ROOT, "scripts"))];
const handWritten = files.filter((file) => !file.includes("/v1/generated/"));
const rel = (file: string) => relative(ROOT, file);

describe("@aroma/guard rules", () => {
  test("one @solana/kit version, pinned exactly, and no aliased copy", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const kits = Object.entries(all).filter(
      ([name, spec]) =>
        name.startsWith("@solana/kit") || spec.includes("@solana/kit@"),
    );
    expect(kits).toEqual([["@solana/kit", "7.1.1"]]);
    const aliased = files.filter(
      (f) => !f.endsWith("rules.test.ts") && code(f).includes("kit-v1"),
    );
    expect(aliased.map(rel)).toEqual([]);
  });

  test("no explicit any in hand-written code", () => {
    const offenders = handWritten.filter(
      (file) =>
        !file.endsWith(".test.ts") &&
        /(:\s*any\b|as any\b|<any>|any\[\])/.test(code(file)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  test("no hand-written file exceeds 400 lines", () => {
    const long = handWritten.filter(
      (file) => readFileSync(file, "utf8").split("\n").length > 400,
    );
    expect(long.map(rel)).toEqual([]);
  });

  test("never imports from apps/*, the web app's aliases or server-only code", () => {
    const bad = files.filter((file) =>
      /from\s+["'](server-only|@\/[^"']*|@aroma\/(web|keeper)[^"']*|(\.\.\/)+apps\/[^"']*|[^"']*\/apps\/[^"']*)["']/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(bad.map(rel)).toEqual([]);
  });

  test("package.json depends on no app", () => {
    const text = readFileSync(join(ROOT, "package.json"), "utf8");
    expect(text).not.toMatch(/"@aroma\/(web|keeper)"/);
  });
});
