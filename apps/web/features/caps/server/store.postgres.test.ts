import { randomUUID } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { afterAll, describe, expect, it } from "vitest";
import { configureLocalNeon, localNeonProxy } from "@/server/db/local-neon";
import * as schema from "@/server/db/schema";
import { reserve, usedOn, type CapsDb } from "./store";

/**
 * W3 under TRUE parallelism on real Postgres: 25 submits on 25 connections at the edge of the
 * daily cap. Local Docker Postgres + Neon proxy only (scripts/local-db.sh); skipped otherwise.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = Boolean(localNeonProxy(url));
let pool: Pool | null = null;
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!enabled)("trade caps on local Postgres (parallel)", () => {
  it("25 parallel $50 reservations against a $200 day: exactly 4 succeed", async () => {
    configureLocalNeon(url);
    pool = new Pool({ connectionString: url, max: 25 });
    const db = drizzle({ client: pool, schema }) as unknown as CapsDb;
    const wallet = `Pg${randomUUID().replace(/-/g, "")}`;
    const day = "2026-11-14";
    const settled = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        reserve(db, {
          requestId: randomUUID(),
          wallet,
          day,
          amount: 50_000_000n,
          cap: 200_000_000n,
          resolveAfter: new Date(Date.now() + 60_000),
        }),
      ),
    );
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(4);
    expect(await usedOn(db, wallet, day)).toBe(200_000_000n);
  }, 60_000);
});
