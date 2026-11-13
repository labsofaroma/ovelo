// Applies the SQL migrations in ./migrations to the Neon database in DATABASE_URL.
// Usage: pnpm db:migrate   (reads DATABASE_URL from the environment; run from apps/web)
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { fileURLToPath } from "node:url";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    process.stderr.write("DATABASE_URL is not set; refusing to migrate.\n");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)),
    });
    process.stdout.write("Migrations applied.\n");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // Print the class only; connection errors can embed the connection string.
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.name : "unknown error"}\n`,
  );
  process.exit(1);
});
