// Build-time environment check (runs before `next build`). Loads .env files exactly like
// Next.js, then validates with the same schema the server uses at boot. Prints variable names only,
// never values. M9: always on (no feature flag). OVELO_SKIP_ENV_CHECK=1 skips it for a LOCAL build
// only; it is refused whenever the production rules apply (server/platform.ts: a Vercel or
// self-host production or beta build, or a contradictory platform answer).
import { loadEnvConfig } from "@next/env";
import { parseEnv } from "../server/env.schema";
import { productionRules } from "../server/platform";

const root = new URL("..", import.meta.url).pathname;
loadEnvConfig(root, process.env.NODE_ENV !== "production");

if (process.env.OVELO_SKIP_ENV_CHECK === "1") {
  if (productionRules(process.env)) {
    process.stderr.write(
      "env check: OVELO_SKIP_ENV_CHECK is refused in a production deployment\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    "env check skipped (OVELO_SKIP_ENV_CHECK=1, local build)\n",
  );
} else {
  const result = parseEnv(process.env);
  if (!result.ok) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  process.stdout.write("env check: ok\n");
}
