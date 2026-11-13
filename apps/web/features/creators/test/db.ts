import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/server/db/schema";
import type { CreatorsDb } from "../db";

const MIGRATIONS = new URL("../../../server/db/migrations/", import.meta.url);

/** A fresh in-process Postgres (PGlite) with the real migrations, including the weights trigger. */
export async function createTestDb(): Promise<{
  db: CreatorsDb;
  client: PGlite;
}> {
  const client = new PGlite();
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(new URL(file, MIGRATIONS), "utf8");
    for (const statement of sql.split("--> statement-breakpoint"))
      if (statement.trim()) await client.exec(statement);
  }
  const db: CreatorsDb = drizzle({ client, schema });
  return { db, client };
}
