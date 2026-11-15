import { randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { pgError, type CreatorsDb } from "@/features/creators/db";
import {
  hashInviteCode,
  INVITE_MAX_DAYS,
  inviteCodeSchema,
} from "@/features/creators/invites";
import { betaAccess, betaInvites } from "@/server/db/schema";
import { AppError } from "@/server/errors";

/**
 * Private-beta invites and access (REWRITE-PLAN §7.3 W2), the M5 creator-invite pattern: only
 * the SHA-256 of a code is stored, single-use by default, always expiring (1–90 days), issued only
 * by the admin CLI (scripts/create-beta-invite.ts, printed once). No `server-only` marker so the
 * CLI can import it under plain Node; it never reaches a client bundle.
 */
export type BetaDb = CreatorsDb;

export const BETA_INVITE_MAX_DAYS = INVITE_MAX_DAYS;
const CODE_PREFIX = "ovelo-beta-";

/** 160 random bits, URL-safe. Shown once by the CLI; only its hash is stored. */
export function generateBetaCode(): string {
  return `${CODE_PREFIX}${randomBytes(20).toString("base64url")}`;
}

export const hashBetaCode = hashInviteCode;
export const betaCodeSchema = inviteCodeSchema;

export async function createBetaInvite(
  db: BetaDb,
  options: { expiresAt: Date; maxUses?: number; now?: Date },
): Promise<{ id: string; code: string; expiresAt: Date; maxUses: number }> {
  const now = options.now ?? new Date();
  const maxUses = options.maxUses ?? 1;
  if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 100)
    throw new AppError("BAD_REQUEST", { detail: "maxUses must be 1..100" });
  const lifetime = options.expiresAt.getTime() - now.getTime();
  if (!(lifetime > 0 && lifetime <= BETA_INVITE_MAX_DAYS * 86_400_000))
    throw new AppError("BAD_REQUEST", {
      detail: `expiry must be within ${BETA_INVITE_MAX_DAYS} days`,
    });
  const code = generateBetaCode();
  const [row] = await db
    .insert(betaInvites)
    .values({
      codeHash: hashBetaCode(code),
      maxUses,
      expiresAt: options.expiresAt,
    })
    .returning({ id: betaInvites.id });
  if (!row)
    throw new AppError("INTERNAL", { detail: "beta invite not inserted" });
  return { id: row.id, code, expiresAt: options.expiresAt, maxUses };
}

export async function hasBetaAccess(
  db: BetaDb,
  wallet: string,
): Promise<boolean> {
  const rows = await db
    .select({ wallet: betaAccess.wallet })
    .from(betaAccess)
    .where(eq(betaAccess.wallet, wallet))
    .limit(1);
  return rows.length > 0;
}

export type Redeemed = {
  wallet: string;
  inviteId: string;
  alreadyHadAccess: boolean;
};

/**
 * Redeem atomically, in one transaction:
 * 1. one conditional UPDATE claims a use only if the code exists, has a use left and has not
 *    expired (`uses < max_uses AND expires_at > now`). Postgres row-locks the invite, so
 *    concurrent redemptions queue and re-check the condition; the CHECK backs it up;
 * 2. the `beta_access` row is inserted. A wallet that already has access rolls the whole
 *    transaction back, so its redemption does not consume the code.
 * The code is checked first: a used or unknown code is refused even for a wallet with access.
 */
export async function redeemBetaInvite(
  db: BetaDb,
  input: { code: string; wallet: string; now?: Date },
): Promise<Redeemed> {
  const now = input.now ?? new Date();
  const code = betaCodeSchema.safeParse(input.code);
  if (!code.success)
    throw new AppError("BETA_INVITE_INVALID", {
      detail: "beta-invite:malformed",
    });
  const codeHash = hashBetaCode(code.data);
  const ALREADY = "beta:already";
  try {
    return await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(betaInvites)
        .set({ uses: sql`${betaInvites.uses} + 1` })
        .where(
          and(
            eq(betaInvites.codeHash, codeHash),
            lt(betaInvites.uses, betaInvites.maxUses),
            gt(betaInvites.expiresAt, now),
          ),
        )
        .returning({ id: betaInvites.id });
      if (!claimed)
        throw new AppError("BETA_INVITE_INVALID", {
          detail: `beta-invite:${await refusalReason(tx, codeHash, now)}`,
        });
      const inserted = await tx
        .insert(betaAccess)
        .values({ wallet: input.wallet, inviteId: claimed.id })
        .onConflictDoNothing({ target: betaAccess.wallet })
        .returning({ wallet: betaAccess.wallet });
      // Already had access: roll back so the code keeps its use.
      if (!inserted.length) throw new Error(ALREADY);
      return {
        wallet: input.wallet,
        inviteId: claimed.id,
        alreadyHadAccess: false,
      };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    const raced = pgError(error)?.code === "23505";
    if ((error instanceof Error && error.message === ALREADY) || raced)
      return { wallet: input.wallet, inviteId: "", alreadyHadAccess: true };
    throw error;
  }
}

/** For logs only: why a code was refused. Clients always get the same message. */
async function refusalReason(
  tx: Pick<BetaDb, "select">,
  codeHash: string,
  now: Date,
): Promise<string> {
  const [row] = await tx
    .select({
      uses: betaInvites.uses,
      maxUses: betaInvites.maxUses,
      expiresAt: betaInvites.expiresAt,
    })
    .from(betaInvites)
    .where(eq(betaInvites.codeHash, codeHash));
  if (!row) return "unknown";
  if (row.expiresAt <= now) return "expired";
  if (row.uses >= row.maxUses) return "used";
  return "unknown";
}
