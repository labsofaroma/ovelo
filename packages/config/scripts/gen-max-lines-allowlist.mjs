// Regenerates max-lines-allowlist.json: the repo-relative paths of source files that
// already exceed the 400-line cap. The list may only SHRINK. New files over the cap fail lint.
// Usage: pnpm --filter @ovelo/config allowlist
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const MAX = 400;
const EXT = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIP = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "target",
  ".git",
  ".anchor",
  "coverage",
]);

const out = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (EXT.test(name) && !name.endsWith(".d.ts")) {
      const lines = readFileSync(path, "utf8").split("\n").length;
      if (lines > MAX) out.push(relative(root, path));
    }
  }
})(root);
out.sort();
writeFileSync(
  join(root, "packages/config/max-lines-allowlist.json"),
  JSON.stringify(
    {
      _comment:
        "Files already over the 400-line cap (warn only). Shrink-only; never add.",
      max: MAX,
      files: out,
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(`${out.length} files over ${MAX} lines\n`);
