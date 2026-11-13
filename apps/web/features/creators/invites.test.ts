import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creators, invites } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import type { CreatorsDb } from "./db";
import {
  createInvite,
  generateInviteCode,
  hashInviteCode,
  redeemInvite,
} from "./invites";
import { createTestDb } from "./test/db";

let db: CreatorsDb;
let client: PGlite;
const NOW = new Date("2026-11-13T12:00:00.000Z");
const DAY = 86_400_000;
const later = (ms: number) => new Date(NOW.getTime() + ms);
const profile = { displayName: "Ada" };

let walletCounter = 0;
/** Distinct base58 strings; the service does not re-validate wallets (the route does). */
const wallet = () =>
  `Wallet${String(++walletCounter).padStart(6, "0")}${"z".repeat(32)}`;

async function code(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof AppError) return `${error.code}:${error.detail}`;
    throw error;
  }
}

beforeAll(async () => {
  ({ db, client } = await createTestDb());
});
afterAll(async () => {
  await client.close();
});

describe("invite codes", () => {
  it("are long, random and URL-safe, and only their hash is stored", async () => {
    const a = generateInviteCode();
    expect(a).toMatch(/^aroma-inv-[A-Za-z0-9_-]{27}$/);
    expect(generateInviteCode()).not.toBe(a);
    const created = await createInvite(db, {
      expiresAt: later(DAY),
      now: NOW,
    });
    const [row] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, created.id));
    expect(row?.codeHash).toBe(hashInviteCode(created.code));
    expect(row?.codeHash).not.toContain(created.code);
    expect(JSON.stringify(row)).not.toContain(created.code);
    expect(row).toMatchObject({ maxUses: 1, uses: 0 });
  });

  it("must expire, within 90 days, and allow 1 to 100 uses", async () => {
    expect(
      await code(() => createInvite(db, { expiresAt: NOW, now: NOW })),
    ).toMatch(/^BAD_REQUEST/);
    expect(
      await code(() =>
        createInvite(db, { expiresAt: later(91 * DAY), now: NOW }),
      ),
    ).toMatch(/^BAD_REQUEST/);
    expect(
      await code(() =>
        createInvite(db, { expiresAt: later(DAY), maxUses: 0, now: NOW }),
      ),
    ).toMatch(/^BAD_REQUEST/);
  });
});

describe("redeeming", () => {
  it("creates the creator with invite_id and consumes the single use", async () => {
    const invite = await createInvite(db, { expiresAt: later(DAY), now: NOW });
    const first = wallet();
    const result = await redeemInvite(db, {
      code: ` ${invite.code} `,
      wallet: first,
      profile: { displayName: "Ada", social: "https://x.com/ada" },
      now: NOW,
    });
    expect(result).toEqual({
      wallet: first,
      displayName: "Ada",
      inviteId: invite.id,
    });
    const [creator] = await db
      .select()
      .from(creators)
      .where(eq(creators.wallet, first));
    expect(creator).toMatchObject({
      inviteId: invite.id,
      social: { url: "https://x.com/ada" },
    });
    expect(
      await code(() =>
        redeemInvite(db, {
          code: invite.code,
          wallet: wallet(),
          profile,
          now: NOW,
        }),
      ),
    ).toBe("FORBIDDEN:invite:used");
  });

  it("refuses an expired code without consuming it", async () => {
    const invite = await createInvite(db, { expiresAt: later(DAY), now: NOW });
    expect(
      await code(() =>
        redeemInvite(db, {
          code: invite.code,
          wallet: wallet(),
          profile,
          now: later(DAY),
        }),
      ),
    ).toBe("FORBIDDEN:invite:expired");
    const [row] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, invite.id));
    expect(row?.uses).toBe(0);
  });

  it("refuses unknown, malformed and never-expiring codes with the same public message", async () => {
    await db.insert(invites).values({
      codeHash: hashInviteCode("legacy-code-without-expiry"),
      expiresAt: null,
    });
    const outcomes: AppError[] = [];
    for (const value of [
      "aroma-inv-doesnotexist000000000000",
      "short",
      "legacy-code-without-expiry",
    ]) {
      try {
        await redeemInvite(db, {
          code: value,
          wallet: wallet(),
          profile,
          now: NOW,
        });
      } catch (error) {
        outcomes.push(error as AppError);
      }
    }
    expect(outcomes.map((e) => e.detail)).toEqual([
      "invite:unknown",
      "invite:malformed",
      "invite:no-expiry",
    ]);
    expect(new Set(outcomes.map((e) => e.publicMessage)).size).toBe(1);
    expect(new Set(outcomes.map((e) => e.code))).toEqual(
      new Set(["FORBIDDEN"]),
    );
  });

  it("does not consume a use when the wallet is already a creator", async () => {
    const first = await createInvite(db, { expiresAt: later(DAY), now: NOW });
    const second = await createInvite(db, { expiresAt: later(DAY), now: NOW });
    const who = wallet();
    await redeemInvite(db, {
      code: first.code,
      wallet: who,
      profile,
      now: NOW,
    });
    expect(
      await code(() =>
        redeemInvite(db, { code: second.code, wallet: who, profile, now: NOW }),
      ),
    ).toBe("CONFLICT:creator:exists");
    const [row] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, second.id));
    expect(row?.uses).toBe(0);
  });

  it("honours max_uses for a multi-use invite", async () => {
    const invite = await createInvite(db, {
      expiresAt: later(DAY),
      maxUses: 3,
      now: NOW,
    });
    const results = [];
    for (let i = 0; i < 5; i += 1)
      results.push(
        await code(() =>
          redeemInvite(db, {
            code: invite.code,
            wallet: wallet(),
            profile,
            now: NOW,
          }),
        ),
      );
    expect(results).toEqual([
      "ok",
      "ok",
      "ok",
      "FORBIDDEN:invite:used",
      "FORBIDDEN:invite:used",
    ]);
  });
});

describe("parallel redemption (single use under concurrency)", () => {
  it("lets exactly one of 25 concurrent redemptions of a single-use code succeed", async () => {
    const invite = await createInvite(db, { expiresAt: later(DAY), now: NOW });
    const wallets = Array.from({ length: 25 }, wallet);
    const settled = await Promise.allSettled(
      wallets.map((w) =>
        redeemInvite(db, { code: invite.code, wallet: w, profile, now: NOW }),
      ),
    );
    const winners = settled.filter((s) => s.status === "fulfilled");
    const losers = settled.flatMap((s) =>
      s.status === "rejected" ? [s.reason as AppError] : [],
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(24);
    expect(new Set(losers.map((e) => e.detail))).toEqual(
      new Set(["invite:used"]),
    );
    const [row] = await db
      .select()
      .from(invites)
      .where(eq(invites.id, invite.id));
    expect(row?.uses).toBe(1);
    const created = await db
      .select()
      .from(creators)
      .where(eq(creators.inviteId, invite.id));
    expect(created).toHaveLength(1);
  });

  it("lets exactly one of 10 concurrent redemptions by the same wallet succeed, using one invite", async () => {
    const codes = await Promise.all(
      Array.from({ length: 10 }, () =>
        createInvite(db, { expiresAt: later(DAY), now: NOW }),
      ),
    );
    const who = wallet();
    const settled = await Promise.allSettled(
      codes.map((invite) =>
        redeemInvite(db, { code: invite.code, wallet: who, profile, now: NOW }),
      ),
    );
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const used = await Promise.all(
      codes.map(async (invite) => {
        const [row] = await db
          .select()
          .from(invites)
          .where(eq(invites.id, invite.id));
        return row?.uses ?? -1;
      }),
    );
    expect(used.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("the schema itself refuses uses beyond max_uses", async () => {
    const invite = await createInvite(db, { expiresAt: later(DAY), now: NOW });
    await expect(
      client.query(`UPDATE invites SET uses = 2 WHERE id = $1`, [invite.id]),
    ).rejects.toThrow(/invites_uses_in_range/);
  });
});
