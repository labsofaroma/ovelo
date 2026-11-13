import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AppError } from "@/server/errors";
import type * as schema from "@/server/db/schema";

/**
 * Any Drizzle Postgres handle over the v1 schema: Neon in the app (`getDb()`), PGlite in tests.
 * Services take it as an argument so they never reach for a global connection themselves.
 */
export type CreatorsDb = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The Postgres SQLSTATE and constraint name of an error, looking through Drizzle's wrapper. */
export function pgError(
  error: unknown,
): { code: string; constraint: string | undefined } | null {
  for (let current = error, depth = 0; current && depth < 4; depth += 1) {
    if (typeof current === "object") {
      const record = current as {
        code?: unknown;
        constraint?: unknown;
        cause?: unknown;
      };
      if (typeof record.code === "string" && /^[0-9A-Z]{5}$/.test(record.code))
        return {
          code: record.code,
          constraint:
            typeof record.constraint === "string"
              ? record.constraint
              : undefined,
        };
      current = record.cause;
    } else break;
  }
  return null;
}

/** Turn the constraint violations a creator can cause into client-safe errors; rethrow the rest. */
export function mapDbError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const pg = pgError(error);
  if (pg?.code === "23505" && pg.constraint?.includes("ticker"))
    throw new AppError("CONFLICT", {
      publicMessage: "That ticker is already used by another basket.",
      detail: `unique:${pg.constraint}`,
      cause: error,
    });
  if (pg?.code === "23505")
    throw new AppError("CONFLICT", {
      detail: `unique:${pg.constraint ?? "unknown"}`,
      cause: error,
    });
  if (pg?.code === "23514" || pg?.code === "23P01")
    throw new AppError("VALIDATION_FAILED", {
      publicMessage:
        "The basket was refused: weights must be whole basis points summing to exactly 10,000.",
      detail: `check:${pg.constraint ?? "unknown"}`,
      cause: error,
    });
  throw error;
}
