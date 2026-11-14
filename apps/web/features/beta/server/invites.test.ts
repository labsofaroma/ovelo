import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "@/features/creators/test/db";
import { betaAccess, betaInvites } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import {
  createBetaInvite,
  generateBetaCode,
  hashBetaCode,
  hasBetaAccess,
  redeemBetaInvite,
  type BetaDb,
} from "./invites";

/** W2 on Postgres (PGlite, migration 0005): hashed, single-use, always-expiring invites. */
let db: BetaDb;
let client: PGlite;
const NOW = new Date("2026-11-14T12:00:00.000Z");
const DAY = 86_400_000;
const later = (ms: number) => new Date(NOW.getTime() + ms);
let counter = 0;
const wallet = () =>
  `Beta${String(++counter).padStart(6, "0")}${"z".repeat(34)}`;

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    const result = (await run()) as { alreadyHadAccess?: boolean };
    return result.alreadyHadAccess ? "already" : "ok";
  } catch (error) {
    if (error instanceof AppError) return `${error.code}:${error.detail}`;
    throw error;
  }
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
});
afterAll(async () => client.close());

describe("beta invites (0005)", () => {
  it("codes are random and URL-safe; only the hash is stored; the default is single-use", async () => {
    expect(generateBetaCode()).toMatch(/^aroma-beta-[A-Za-z0-9_-]{27}$/);
    const invite = await createBetaInvite(db, {
      expiresAt: later(DAY),
      now: NOW,
    });
    const [row] = await db
      .select()
      .from(betaInvites)
      .where(eq(betaInvites.id, invite.id));
    expect(row?.codeHash).toBe(hashBetaCode(invite.code));
    expect(JSON.stringify(row)).not.toContain(invite.code);
    expect(row).toMatchObject({ maxUses: 1, uses: 0 });
  });

  it("every invite expires (1..90 days) and uses are 1..100", async () => {
    for (const options of [
      { expiresAt: NOW },
      { expiresAt: later(91 * DAY) },
      { expiresAt: later(DAY), maxUses: 0 },
      { expiresAt: later(DAY), maxUses: 101 },
    ])
      expect(
        await outcome(() => createBetaInvite(db, { ...options, now: NOW })),
      ).toMatch(/^BAD_REQUEST/);
    await expect(
      client.exec(
        `INSERT INTO beta_invites (code_hash, expires_at) VALUES ('${"a".repeat(64)}', NULL)`,
      ),
    ).rejects.toThrow();
  });

  it("redeem grants access once; a used, expired, unknown or malformed code is refused", async () => {
    const invite = await createBetaInvite(db, {
      expiresAt: later(DAY),
      now: NOW,
    });
    const first = wallet();
    expect(await hasBetaAccess(db, first)).toBe(false);
    expect(
      await outcome(() =>
        redeemBetaInvite(db, { code: invite.code, wallet: first, now: NOW }),
      ),
    ).toBe("ok");
    expect(await hasBetaAccess(db, first)).toBe(true);
    // Used: refused for another wallet AND for the same wallet (the code is checked first).
    expect(
      await outcome(() =>
        redeemBetaInvite(db, { code: invite.code, wallet: wallet(), now: NOW }),
      ),
    ).toBe("BETA_INVITE_INVALID:beta-invite:used");
    expect(
      await outcome(() =>
        redeemBetaInvite(db, { code: invite.code, wallet: first, now: NOW }),
      ),
    ).toBe("BETA_INVITE_INVALID:beta-invite:used");
    const old = await createBetaInvite(db, { expiresAt: later(DAY), now: NOW });
    expect(
      await outcome(() =>
        redeemBetaInvite(db, {
          code: old.code,
          wallet: wallet(),
          now: later(DAY),
        }),
      ),
    ).toBe("BETA_INVITE_INVALID:beta-invite:expired");
    expect(
      await outcome(() =>
        redeemBetaInvite(db, {
          code: generateBetaCode(),
          wallet: wallet(),
          now: NOW,
        }),
      ),
    ).toBe("BETA_INVITE_INVALID:beta-invite:unknown");
    expect(
      await outcome(() =>
        redeemBetaInvite(db, { code: "short", wallet: wallet(), now: NOW }),
      ),
    ).toBe("BETA_INVITE_INVALID:beta-invite:malformed");
  });

  it("a wallet that already has access does not consume another code", async () => {
    const a = await createBetaInvite(db, { expiresAt: later(DAY), now: NOW });
    const b = await createBetaInvite(db, { expiresAt: later(DAY), now: NOW });
    const w = wallet();
    await redeemBetaInvite(db, { code: a.code, wallet: w, now: NOW });
    expect(
      await outcome(() =>
        redeemBetaInvite(db, { code: b.code, wallet: w, now: NOW }),
      ),
    ).toBe("already");
    const [row] = await db
      .select()
      .from(betaInvites)
      .where(eq(betaInvites.id, b.id));
    expect(row?.uses).toBe(0);
  });

  it("25 parallel redemptions of a single-use code grant exactly one wallet", async () => {
    const invite = await createBetaInvite(db, {
      expiresAt: later(DAY),
      now: NOW,
    });
    const wallets = Array.from({ length: 25 }, wallet);
    const results = await Promise.all(
      wallets.map((w) =>
        outcome(() =>
          redeemBetaInvite(db, { code: invite.code, wallet: w, now: NOW }),
        ),
      ),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
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
  });

  it("a 3-use code grants exactly three of 10 parallel wallets", async () => {
    const invite = await createBetaInvite(db, {
      expiresAt: later(DAY),
      maxUses: 3,
      now: NOW,
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, wallet).map((w) =>
        outcome(() =>
          redeemBetaInvite(db, { code: invite.code, wallet: w, now: NOW }),
        ),
      ),
    );
    expect(results.filter((r) => r === "ok")).toHaveLength(3);
  });
});
