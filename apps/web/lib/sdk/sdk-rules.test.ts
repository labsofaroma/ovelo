// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/** Repo rules from REWRITE-PLAN M2 that a regression should fail loudly. */
const WEB = join(import.meta.dirname, "../..");
const PORTED = [
  "core",
  "pyth",
  "jupiter",
  "markets",
  "research",
  "baskets",
  "paper",
  "trade",
  // M6: the v1 contract client. Only its Codama output (`guard/v1/generated/`) is exempt from
  // the 400-line rule; every other rule applies to it too.
  "guard/v1",
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
/** Source with comments removed, so prose like "any source" never trips a code rule. */
const code = (file: string): string =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const files = PORTED.flatMap((dir) => sources(join(import.meta.dirname, dir)));

describe("SDK rules", () => {
  test("one @solana/kit version: no aliased second copy anywhere in the web app", () => {
    const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const kits = Object.entries(pkg.dependencies).filter(
      ([name, spec]) =>
        name.startsWith("@solana/kit") || spec.includes("@solana/kit@"),
    );
    expect(kits.map(([name]) => name)).toEqual(["@solana/kit"]);
    const offenders = [
      ...sources(join(WEB, "lib")),
      ...sources(join(WEB, "tests")),
    ].filter(
      (file) =>
        !file.endsWith("sdk-rules.test.ts") &&
        readFileSync(file, "utf8").includes("kit-v1"),
    );
    expect(offenders.map((file) => relative(WEB, file))).toEqual([]);
  });

  test("ported modules use no explicit any (public types stay checkable)", () => {
    const offenders = files.filter(
      (file) =>
        !file.endsWith(".test.ts") &&
        /(:\s*any\b|as any\b|<any>|any\[\])/.test(code(file)),
    );
    expect(offenders.map((file) => relative(WEB, file))).toEqual([]);
  });

  test("no ported source file exceeds 400 lines", () => {
    const long = files.filter(
      (file) =>
        !file.includes("/idl/") &&
        !file.includes("/guard/v1/generated/") &&
        readFileSync(file, "utf8").split("\n").length > 400,
    );
    expect(long.map((file) => relative(WEB, file))).toEqual([]);
  });

  test("ported modules never import server-only code or the app layer", () => {
    const bad = files.filter((file) =>
      /from\s+["'](server-only|@\/(?:app|components|server)[^"']*)["']/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(bad.map((file) => relative(WEB, file))).toEqual([]);
  });
});
