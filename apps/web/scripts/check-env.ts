// Build-time environment check (runs before `next build`). Loads .env files exactly like
// Next.js, then validates with the same schema the server uses at boot. Prints variable names only,
// never values. M9: always on (no feature flag). AROMA_SKIP_ENV_CHECK=1 skips it for a LOCAL build
// only; on a Vercel production build it is refused.
import { loadEnvConfig } from "@next/env";
import { parseEnv } from "../server/env.schema";

const root = new URL("..", import.meta.url).pathname;
loadEnvConfig(root, process.env.NODE_ENV !== "production");

if (process.env.AROMA_SKIP_ENV_CHECK === "1") {
  if (process.env.VERCEL_ENV === "production") {
    process.stderr.write(
      "env check: AROMA_SKIP_ENV_CHECK is refused in a production deployment\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    "env check skipped (AROMA_SKIP_ENV_CHECK=1, local build)\n",
  );
} else {
  const result = parseEnv(process.env);
  if (!result.ok) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  process.stdout.write("env check: ok\n");
}
