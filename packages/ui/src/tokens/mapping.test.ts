// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_ROOT } from "../test/css";

const STYLES = resolve(PACKAGE_ROOT, "../../apps/web/styles");
const readme = readFileSync(resolve(PACKAGE_ROOT, "README.md"), "utf8");

/**
 * The README's old-to-new table must cover every legacy variable. Delete this test when the
 * prototype stylesheets are deleted (M7): the files it reads will be gone.
 */
describe.skipIf(!existsSync(STYLES))("README token mapping", () => {
  const legacy = ["foundation.css", "theme-surfaces.css"].flatMap((file) =>
    [
      ...readFileSync(resolve(STYLES, file), "utf8").matchAll(
        /^\s*(--[a-z0-9-]+):/gm,
      ),
    ].map((m) => m[1] as string),
  );
  const unique = [...new Set(legacy)];

  it("finds the legacy variables", () => {
    expect(unique.length).toBeGreaterThan(30);
  });

  it.each(unique)("documents %s", (name) => {
    const space = /^--space-(\d+)$/.exec(name);
    const text = /^--text-/.test(name);
    const found =
      readme.includes(`\`${name}\``) ||
      (space && readme.includes("`--space-1` `--space-2`")) ||
      (text && readme.includes(`\`${name}\``));
    expect(
      found,
      `${name} is missing from the mapping table in README.md`,
    ).toBeTruthy();
  });
});
