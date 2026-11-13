/**
 * Runs Tailwind v3 and v4 side by side, each only on the CSS it owns (REWRITE-PLAN §3, M1).
 *
 *  - `*.v4.css` entry files (see app/aroma-ui.v4.css) are compiled by Tailwind v4 only.
 *  - Every other stylesheet (the prototype's globals.css chain) is compiled by Tailwind v3 only,
 *    exactly as before.
 *
 * Why not just chain both plugins: v4 inlines `@import`s and rejects `@tailwind base`, so it
 * would rewrite the prototype's CSS chain; v3 would see v4's `@theme`/`@utility`. Routing by
 * file keeps each version blind to the other's input.
 *
 * Next.js only accepts PostCSS plugins given as strings, hence this small wrapper module
 * (postcss.config.js refers to it by path). Delete it when the last prototype stylesheet goes
 * (M7) and point postcss.config.js at "@tailwindcss/postcss" alone.
 */
const postcss = require("postcss");
const tailwindV3 = require("tailwindcss"); // resolves to apps/web's pinned v3
const tailwindV4 = require("@tailwindcss/postcss");

const V4_FILE = /\.v4\.css$/;

const v3Processor = postcss([tailwindV3]);
const v4Processor = postcss([tailwindV4]);

function creator() {
  return {
    postcssPlugin: "aroma-tailwind-router",
    async Once(root, { result }) {
      const file = root.source?.input.file ?? "";
      const processor = V4_FILE.test(file) ? v4Processor : v3Processor;
      // Passing the Root processes it in place; messages carry watch dependencies for HMR.
      const out = await processor.process(root, {
        from: file || undefined,
        map: false,
      });
      result.messages.push(...out.messages);
    },
  };
}
creator.postcss = true;

module.exports = creator;
