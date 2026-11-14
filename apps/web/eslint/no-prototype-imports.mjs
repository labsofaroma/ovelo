import path from "node:path";

/**
 * M9 Step 1: kept code must not import prototype code, so the prototype can be deleted without
 * breaking anything that stays. A local rule (no plugin dependency): it resolves every `@/…` or
 * relative specifier to its path inside apps/web and refuses it when that path is prototype-owned.
 * Covers `import`, `export … from`, `import()`, `require()` and type-only `import("…")`.
 *
 * Prototype-owned (docs/launch/CUTOVER-MAP.md §1, plus the lib/sdk barrel, which re-exports
 * prototype modules until Step 6 deletes them). Paths are relative to apps/web, without extension.
 */
export const PROTOTYPE_PATH =
  /^(app\/\(prototype\)(\/|$)|app\/api\/(?!v1(\/|$))[^/]+(\/|$)|components(\/|$)|styles(\/|$)|lib\/server(\/|$)|lib\/(company-logos|metadata|pending-mainnet|recurring-links|site)$|lib\/sdk$|lib\/sdk\/(index|index\.shared)$|lib\/sdk\/(client|state|portfolio|subscriptions)(\/|$)|lib\/sdk\/(recurring-investing|devnet-xstocks|wallet-capabilities)(\.test)?$|lib\/sdk\/guard\/(aroma_guard|client|devnet)$|tests(\/|$)|tailwind\.config$|postcss\/tailwind-router$|scripts\/verify-pricing-oracles$)/;

/** apps/web, from this file's location (independent of where ESLint runs). */
const APP_ROOT = path.resolve(import.meta.dirname, "..");

const EXTENSION = /\.(m?[jt]sx?|cjs|cts|mts|json|css)$/;

/** The apps/web-relative path a specifier points at, or null if it leaves the app or is a package. */
export function resolveInApp(fileFromApp, specifier) {
  let target;
  if (specifier.startsWith("@/")) target = specifier.slice(2);
  else if (
    specifier === "." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  )
    target = path.posix.join(path.posix.dirname(fileFromApp), specifier);
  else return null;
  target = path.posix.normalize(target).replace(/\/$/, "");
  if (target === ".." || target.startsWith("../")) return null;
  return target.replace(EXTENSION, "").replace(/\/index$/, "") || ".";
}

export function isPrototypePath(fromApp) {
  const bare = fromApp.replace(EXTENSION, "");
  return PROTOTYPE_PATH.test(bare) || PROTOTYPE_PATH.test(`${bare}/index`);
}

const MESSAGE =
  "Kept code must not import prototype code ({{target}}); the prototype is deleted in the M9 cutover (docs/launch/CUTOVER-MAP.md). Import the v1 module instead.";

export const noPrototypeImports = {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid imports of prototype code from kept code (M9).",
    },
    schema: [],
    messages: { prototype: MESSAGE },
  },
  create(context) {
    const fileFromApp = path
      .relative(APP_ROOT, context.filename)
      .split(path.sep)
      .join("/");
    // The rule judges kept files only; prototype files may import each other until deleted.
    if (fileFromApp.startsWith("../") || isPrototypePath(fileFromApp))
      return {};
    const check = (node, source) => {
      if (!source || typeof source.value !== "string") return;
      const target = resolveInApp(fileFromApp, source.value);
      if (target && isPrototypePath(target))
        context.report({ node, messageId: "prototype", data: { target } });
    };
    return {
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) =>
        node.source.type === "Literal" && check(node, node.source),
      TSImportType: (node) =>
        check(node, node.argument?.literal ?? node.argument),
      CallExpression: (node) => {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments[0]?.type === "Literal"
        )
          check(node, node.arguments[0]);
      },
    };
  },
};
