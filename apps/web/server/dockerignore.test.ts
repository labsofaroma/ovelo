import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase H Step 3: the image build context (.dockerignore at the repo root) is an allowlist, and
 * secrets, keys, local chain state, dependencies and test output stay out of it. A line removed
 * or reordered by accident fails here before it can leak into an image layer.
 */
const ROOT = join(import.meta.dirname, "..", "..", "..");
const lines = readFileSync(join(ROOT, ".dockerignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const REQUIRED_EXCLUDES = [
  "**/.env",
  "**/.env.*",
  ".git",
  "**/.git",
  ".keys",
  "**/.keys",
  ".e2e-local",
  "**/.e2e-local",
  ".e2e-fork",
  ".devnet",
  "**/.devnet",
  "**/*.keypair.json",
  "**/id.json",
  "packages/contracts/target",
  "**/target",
  "node_modules",
  "**/node_modules",
  "**/.next",
  "**/test-results",
  "**/playwright-report",
  "**/coverage",
  "**/screenshots",
  "**/*.log",
];

describe(".dockerignore", () => {
  it("starts by excluding everything (allowlist)", () => {
    expect(lines[0]).toBe("*");
  });

  it.each(REQUIRED_EXCLUDES)("excludes %s", (pattern) => {
    expect(lines).toContain(pattern);
  });

  it("every exclusion comes after the last allowlist entry (later lines win)", () => {
    const includes = lines
      .map((l, i) => [l, i] as const)
      .filter(([l]) => l.startsWith("!") && l !== "!apps/web/.env.example");
    const lastInclude = Math.max(...includes.map(([, i]) => i));
    for (const pattern of REQUIRED_EXCLUDES)
      expect(lines.indexOf(pattern), pattern).toBeGreaterThan(lastInclude);
  });

  it("re-includes no env file except the template, and never a key or the contract target", () => {
    const reincluded = lines.filter((l) => l.startsWith("!"));
    expect(reincluded.filter((l) => /\.env/.test(l))).toEqual([
      "!apps/web/.env.example",
    ]);
    expect(
      reincluded.filter((l) =>
        /keys|keypair|target|\.devnet|e2e-local/.test(l),
      ),
    ).toEqual([]);
    // Only the manifest of the contracts package, never its sources.
    expect(
      reincluded.filter((l) => l.startsWith("!packages/contracts")),
    ).toEqual(["!packages/contracts/package.json"]);
  });
});
