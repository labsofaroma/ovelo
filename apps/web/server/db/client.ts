import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { AppError } from "../errors";
import { tryGetEnv } from "../env";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>["db"];

function createDb(url: string) {
  // The WebSocket Pool (not neon-http) is used so multi-statement transactions work: basket
  // publishing writes allocations and relies on the deferred weights-sum constraint at COMMIT.
  const pool = new Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: 5000,
  });
  return { pool, db: drizzle({ client: pool, schema }) };
}

let instance: ReturnType<typeof createDb> | undefined;

/** Lazily created, process-wide Drizzle handle on Neon Postgres. */
export function getDb(): Database {
  if (!instance) {
    const result = tryGetEnv();
    const url = result.ok ? result.env.server.DATABASE_URL : undefined;
    if (!url)
      throw new AppError("SERVICE_UNAVAILABLE", {
        detail: "DATABASE_URL is not configured",
      });
    instance = createDb(url);
  }
  return instance.db;
}

/** Cheap liveness probe used by /api/v1/health. */
export async function pingDb(): Promise<void> {
  getDb();
  await instance?.pool.query("select 1");
}

export * as dbSchema from "./schema";
