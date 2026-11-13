// Build-time environment check (runs as `prebuild`). Loads .env files exactly like Next.js, then
// validates with the same schema the server uses at boot. Prints variable names only, never values.
// Skip deliberately with AROMA_SKIP_ENV_CHECK=1 (e.g. a prototype-only build).
import { loadEnvConfig } from "@next/env";
import { parseEnv } from "../server/env.schema";

const root = new URL("..", import.meta.url).pathname;
loadEnvConfig(root, process.env.NODE_ENV !== "production");

if (process.env.AROMA_SKIP_ENV_CHECK === "1") {
  process.stdout.write("env check skipped (AROMA_SKIP_ENV_CHECK=1)\n");
} else if (process.env.AROMA_V1_ENABLED?.trim() !== "true") {
  process.stdout.write("env check: AROMA_V1_ENABLED is not true; only the prototype is built, v1 variables not required\n");
} else {
  const result = parseEnv(process.env);
  if (!result.ok) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  process.stdout.write("env check: ok\n");
}
