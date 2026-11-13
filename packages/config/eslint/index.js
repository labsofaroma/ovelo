// @ts-check
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const MAX_LINES = 400;
const here = dirname(new URL(import.meta.url).pathname);
const allowlist = /** @type {{ files: string[] }} */ (
  JSON.parse(readFileSync(join(here, "../max-lines-allowlist.json"), "utf8"))
).files;

function findRepoRoot(from) {
  let dir = from;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error("pnpm-workspace.yaml not found above " + from);
    dir = parent;
  }
  return dir;
}

/**
 * Build the flat config for one workspace package.
 *
 * @param {object} options
 * @param {string} options.dir Absolute path of the package (pass `import.meta.dirname`).
 * @param {boolean} [options.next] Enable the Next.js and React hooks rules.
 * @param {string[]} [options.legacy] Globs (relative to `dir`) holding prototype code. The
 *   recommended rules are warnings there instead of errors, so old code does not block CI.
 * @param {string[]} [options.legacyExclude] Globs inside `legacy` that are NOT legacy.
 * @param {string[]} [options.ignores] Extra ignore globs.
 */
export function createConfig({
  dir,
  next = false,
  legacy = [],
  legacyExclude = [],
  ignores = [],
}) {
  const repoRoot = findRepoRoot(dir);
  const prefix = relative(repoRoot, dir).split(sep).join("/");
  const oversized = allowlist
    .filter((file) => prefix === "" || file.startsWith(prefix + "/"))
    .map((file) => (prefix === "" ? file : file.slice(prefix.length + 1)));

  return tseslint.config(
    {
      ignores: [
        "**/node_modules/**",
        "**/.next/**",
        // M4: the E2E build (with the test wallet bridge) is written here by e2e/fork/run.ts.
        "**/.next-e2e/**",
        "**/.e2e-fork/**",
        "**/.turbo/**",
        "**/dist/**",
        "**/coverage/**",
        "**/next-env.d.ts",
        "**/drizzle/**",
        ...ignores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: { globals: { ...globals.node, ...globals.browser } },
      linterOptions: { reportUnusedDisableDirectives: "error" },
      rules: {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unused-vars": [
          "error",
          {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
          },
        ],
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { fixStyle: "inline-type-imports" },
        ],
        eqeqeq: ["error", "always", { null: "ignore" }],
        "no-console": ["error", { allow: ["warn", "error"] }],
        "max-lines": [
          "error",
          { max: MAX_LINES, skipBlankLines: false, skipComments: false },
        ],
      },
    },
    ...(next
      ? [
          {
            plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
            rules: {
              ...nextPlugin.configs.recommended.rules,
              ...nextPlugin.configs["core-web-vitals"].rules,
              "react-hooks/rules-of-hooks": "error",
              "react-hooks/exhaustive-deps": "warn",
              "@next/next/no-html-link-for-pages": "off",
            },
            settings: { next: { rootDir: dir } },
          },
        ]
      : []),
    // Prototype code: recommended rules report but do not fail CI. New code is held to errors.
    ...(legacy.length
      ? [
          {
            files: legacy,
            ignores: legacyExclude,
            rules: {
              "@typescript-eslint/no-explicit-any": "warn",
              "@typescript-eslint/no-unused-vars": "warn",
              "@typescript-eslint/no-require-imports": "warn",
              "@typescript-eslint/consistent-type-imports": "off",
              "@typescript-eslint/ban-ts-comment": "warn",
              "@typescript-eslint/no-unused-expressions": "warn",
              "@typescript-eslint/no-empty-object-type": "warn",
              "no-console": "off",
              "no-empty": "warn",
              "no-useless-escape": "warn",
              "no-control-regex": "warn",
              "prefer-const": "warn",
              "react-hooks/rules-of-hooks": "warn",
              "react-hooks/exhaustive-deps": "warn",
              "@next/next/no-img-element": "warn",
              "@next/next/no-assign-module-variable": "warn",
              "@next/next/no-page-custom-font": "warn",
              "@next/next/no-sync-scripts": "warn",
            },
          },
        ]
      : []),
    // Known oversized files: warn only. The list is shrink-only (see scripts/gen-max-lines-allowlist.mjs).
    ...(oversized.length
      ? [
          {
            files: oversized,
            rules: { "max-lines": ["warn", { max: MAX_LINES }] },
          },
        ]
      : []),
    {
      files: ["**/*.test.{ts,tsx,mjs,cjs}", "**/tests/**", "**/test/**"],
      rules: {
        "no-console": "off",
        "@typescript-eslint/no-explicit-any": "warn",
      },
    },
    prettier,
  );
}

export { MAX_LINES };
