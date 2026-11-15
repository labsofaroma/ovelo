// Phase H Step 5: bundle the migration runner (apps/web/server/db/migrate.ts) into one plain ESM
// file for the image, so deploy.sh can run migrations as a one-shot container with the separate
// migration role. Uses the esbuild that tsx (an existing dependency) ships: no new dependency.
// Run in the image build stage from the repo root:  node deploy/build-migrate.mjs <outdir>
import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? "dist/deploy");
const require = createRequire(import.meta.url);
const tsx = dirname(
  require.resolve("tsx/package.json", { paths: [resolve("apps/web")] }),
);
const esbuild = require(require.resolve("esbuild", { paths: [tsx] }));

await esbuild.build({
  entryPoints: [resolve("apps/web/server/db/migrate.ts")],
  outfile: join(out, "migrate.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // CommonJS dependencies bundled into ESM need a require().
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "warning",
});
cpSync(resolve("apps/web/server/db/migrations"), join(out, "migrations"), {
  recursive: true,
});
process.stdout.write(`migrate bundle: ${join(out, "migrate.mjs")}\n`);
