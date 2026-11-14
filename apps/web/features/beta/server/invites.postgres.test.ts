import { randomBytes } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { getAddressDecoder } from "@solana/kit";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { afterAll, describe, expect, it } from "vitest";
import { configureLocalNeon, localNeonProxy } from "@/server/db/local-neon";
import * as schema from "@/server/db/schema";
import { betaAccess, betaInvites } from "@/server/db/schema";
import { createBetaInvite, redeemBetaInvite, type BetaDb } from "./invites";

/**
 * W2 under TRUE parallelism on real Postgres (PGlite runs transactions one at a time). Runs only
 * against the local Docker Postgres + Neon proxy (scripts/local-db.sh: DATABASE_URL on loopback
 * and AROMA_LOCAL_NEON_WS_PROXY set), through the same Neon driver production uses, on 25
 * connections. Skipped otherwise, so `pnpm test` needs no database.
 */
const url = process.env.DATABASE_URL ?? "";
const enabled = Boolean(localNeonProxy(url));
let pool: Pool | null = null;
afterAll(async () => {
  await pool?.end();
});

describe.skipIf(!enabled)("beta invites on local Postgres (parallel)", () => {
  it("exactly one of 25 parallel redemptions on 25 connections succeeds", async () => {
    configureLocalNeon(url);
    pool = new Pool({ connectionString: url, max: 25 });
    const db = drizzle({ client: pool, schema }) as unknown as BetaDb;
    const now = new Date();
    const invite = await createBetaInvite(db, {
      expiresAt: new Date(now.getTime() + 86_400_000),
      now,
    });
    const wallets = Array.from({ length: 25 }, () =>
      getAddressDecoder().decode(randomBytes(32)),
    );
    const settled = await Promise.allSettled(
      wallets.map((wallet) =>
        redeemBetaInvite(db, { code: invite.code, wallet, now }),
      ),
    );
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const [row] = await db
      .select()
      .from(betaInvites)
      .where(eq(betaInvites.id, invite.id));
    expect(row?.uses).toBe(1);
    const granted = await db
      .select()
      .from(betaAccess)
      .where(eq(betaAccess.inviteId, invite.id));
    expect(granted).toHaveLength(1);
  }, 60_000);
});
