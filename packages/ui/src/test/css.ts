import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
export const readCss = (file: string): string =>
  readFileSync(resolve(PACKAGE_ROOT, file), "utf8");

/** Parses `--name: value;` declarations out of a CSS block body. */
export function parseDeclarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[match[1] as string] = (match[2] as string).trim();
  }
  return out;
}

export interface ThemeBlocks {
  light: Record<string, string>;
  darkAttribute: Record<string, string>;
  darkMedia: Record<string, string>;
  reducedMotion: Record<string, string>;
  root: Record<string, string>;
}

/** Extracts the blocks of tokens.css that define themes, in the order the cascade sees them. */
export function readThemeBlocks(css = readCss("tokens.css")): ThemeBlocks {
  const strip = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const body = (re: RegExp): Record<string, string> => {
    const match = re.exec(strip);
    if (!match) throw new Error(`block not found: ${re}`);
    return parseDeclarations(match[1] as string);
  };
  const rootBlocks = [...strip.matchAll(/(?:^|\n):root\s*\{([^}]*)\}/g)].map(
    (m) => parseDeclarations(m[1] as string),
  );
  return {
    light: body(/:root,\s*\[data-theme="light"\]\s*\{([^}]*)\}/),
    darkAttribute: body(/\n\[data-theme="dark"\]\s*\{([^}]*)\}/),
    darkMedia: body(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/,
    ),
    reducedMotion: body(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/,
    ),
    root: Object.assign({}, ...rootBlocks),
  };
}
