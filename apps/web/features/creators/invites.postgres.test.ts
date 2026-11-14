import { randomBytes } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { getAddressDecoder } from "@solana/kit";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { afterAll, describe, expect, it } from "vitest";
import { configureLocalNeon, localNeonProxy } from "@/server/db/local-neon";
import * as schema from "@/server/db/schema";
import { creators, invites } from "@/server/db/schema";
import type { CreatorsDb } from "./db";
import { createInvite, redeemInvite } from "./invites";

/**
 * Single-use invites under TRUE parallelism on real Postgres (M5a deviation 4: PGlite runs
 * transactions one at a time). Runs only against the local Docker Postgres + Neon proxy from
 * scripts/local-db.sh (DATABASE_URL on loopback and AROMA_LOCAL_NEON_WS_PROXY set): it opens 25
 * pooled connections through the same Neon serverless driver production uses. Skipped otherwise,
 * so `pnpm test` needs no database.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = Boolean(localNeonProxy(url));
let pool: Pool | null = null;

afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!enabled)("invites on local Postgres (parallel)", () => {
  it("exactly one of 25 parallel redemptions on 25 connections succeeds", async () => {
    configureLocalNeon(url);
    pool = new Pool({ connectionString: url, max: 25 });
    const db = drizzle({ client: pool, schema }) as unknown as CreatorsDb;
    const now = new Date();
    const invite = await createInvite(db, {
      expiresAt: new Date(now.getTime() + 86_400_000),
      now,
    });
    const wallets = Array.from({ length: 25 }, () =>
      getAddressDecoder().decode(randomBytes(32)),
    );
    const settled = await Promise.allSettled(
      wallets.map((wallet) =>
        redeemInvite(db, {
          code: invite.code,
          wallet,
          profile: { displayName: "Parallel" },
          now,
        }),
      ),
    );
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const [row] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, invite.id));
    expect(row?.uses).toBe(1);
    const created = await db
      .select()
      .from(creators)
      .where(inArray(creators.wallet, wallets));
    expect(created).toHaveLength(1);
  }, 60_000);
});
