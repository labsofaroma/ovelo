import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { creators, invites } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { type CreatorsDb, mapDbError, pgError } from "./db";
import type { CreatorProfile } from "./schema";

/**
 * Creator invites (AUDIT §4.4): single-use by default, always expiring, stored only as a hash.
 * Server code (node:crypto, Drizzle). It has no `server-only` marker so the admin CLI
 * (scripts/create-invite.ts) can import it under plain Node; it can never reach a client bundle.
 */

export const INVITE_MAX_DAYS = 90;
const CODE_PREFIX = "ovelo-inv-";

export const inviteCodeSchema = z
  .string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/** 160 random bits, URL-safe. Shown once by the CLI; only its hash is stored. */
export function generateInviteCode(): string {
  return `${CODE_PREFIX}${randomBytes(20).toString("base64url")}`;
}

/** SHA-256 (hex) of the trimmed code. The codes are random, so no pepper is needed. */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

export async function createInvite(
  db: CreatorsDb,
  options: { expiresAt: Date; maxUses?: number; now?: Date },
): Promise<{ id: string; code: string; expiresAt: Date; maxUses: number }> {
  const now = options.now ?? new Date();
  const maxUses = options.maxUses ?? 1;
  if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 100)
    throw new AppError("BAD_REQUEST", { detail: "maxUses must be 1..100" });
  const lifetime = options.expiresAt.getTime() - now.getTime();
  if (!(lifetime > 0 && lifetime <= INVITE_MAX_DAYS * 86_400_000))
    throw new AppError("BAD_REQUEST", {
      detail: `expiry must be within ${INVITE_MAX_DAYS} days`,
    });
  const code = generateInviteCode();
  const [row] = await db
    .insert(invites)
    .values({
      codeHash: hashInviteCode(code),
      maxUses,
      expiresAt: options.expiresAt,
    })
    .returning({ id: invites.id });
  if (!row) throw new AppError("INTERNAL", { detail: "invite not inserted" });
  return { id: row.id, code, expiresAt: options.expiresAt, maxUses };
}

const REFUSED =
  "This invite code is not valid, has expired or was already used.";

/**
 * Redeem atomically, in one transaction:
 * 1. a single conditional UPDATE claims one use only if the code exists, has a use left and has
 *    an expiry in the future (invites without an expiry are refused: fail closed). Postgres
 *    row-locks the invite, so concurrent redemptions queue and re-check `uses < max_uses`;
 * 2. the `creators` row is inserted with `invite_id`. If the wallet is already a creator the
 *    whole transaction rolls back, so the use is not consumed.
 * The CHECK `uses <= max_uses` backs this up in the schema.
 */
export async function redeemInvite(
  db: CreatorsDb,
  input: { code: string; wallet: string; profile: CreatorProfile; now?: Date },
): Promise<{ wallet: string; displayName: string; inviteId: string }> {
  const now = input.now ?? new Date();
  const code = inviteCodeSchema.safeParse(input.code);
  if (!code.success)
    throw new AppError("FORBIDDEN", {
      publicMessage: REFUSED,
      detail: "invite:malformed",
    });
  const codeHash = hashInviteCode(code.data);
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select({ wallet: creators.wallet })
        .from(creators)
        .where(eq(creators.wallet, input.wallet));
      if (existing.length)
        throw new AppError("CONFLICT", {
          publicMessage: "This wallet is already a creator.",
          detail: "creator:exists",
        });
      const [claimed] = await tx
        .update(invites)
        .set({ uses: sql`${invites.uses} + 1` })
        .where(
          and(
            eq(invites.codeHash, codeHash),
            lt(invites.uses, invites.maxUses),
            isNotNull(invites.expiresAt),
            gt(invites.expiresAt, now),
          ),
        )
        .returning({ id: invites.id });
      if (!claimed)
        throw new AppError("FORBIDDEN", {
          publicMessage: REFUSED,
          detail: `invite:${await refusalReason(tx, codeHash, now)}`,
        });
      await tx.insert(creators).values({
        wallet: input.wallet,
        displayName: input.profile.displayName,
        social: input.profile.social ? { url: input.profile.social } : {},
        inviteId: claimed.id,
      });
      return {
        wallet: input.wallet,
        displayName: input.profile.displayName,
        inviteId: claimed.id,
      };
    });
  } catch (error) {
    // A concurrent redemption by the same wallet loses on the primary key.
    if (pgError(error)?.code === "23505")
      throw new AppError("CONFLICT", {
        publicMessage: "This wallet is already a creator.",
        detail: "creator:exists(race)",
        cause: error,
      });
    return mapDbError(error);
  }
}

/** For logs only: why a code was refused. Clients always get the same message. */
async function refusalReason(
  tx: Pick<CreatorsDb, "select">,
  codeHash: string,
  now: Date,
): Promise<string> {
  const [row] = await tx
    .select({
      uses: invites.uses,
      maxUses: invites.maxUses,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .where(eq(invites.codeHash, codeHash));
  if (!row) return "unknown";
  if (!row.expiresAt) return "no-expiry";
  if (row.expiresAt <= now) return "expired";
  if (row.uses >= row.maxUses) return "used";
  return "unknown";
}
