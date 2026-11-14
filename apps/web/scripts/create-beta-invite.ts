// Creates one PRIVATE-BETA invite (REWRITE-PLAN §7.3 W2) and prints its code ONCE. Only the
// SHA-256 of the code is stored. The M5 creator-invite CLI pattern (scripts/create-invite.ts).
// Usage (from apps/web, DATABASE_URL in the environment):
//   pnpm beta:invite [--days 7] [--uses 1]
// Invites always expire (at most 90 days) and are single-use unless --uses says otherwise.
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { configureLocalNeon } from "../server/db/local-neon";
import * as schema from "../server/db/schema";
import {
  BETA_INVITE_MAX_DAYS,
  createBetaInvite,
  type BetaDb,
} from "../features/beta/server/invites";

function readInt(args: string[], flag: string, fallback: number): number {
  const index = args.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isSafeInteger(value)) {
    process.stderr.write(`${flag} needs a whole number.\n`);
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    process.stdout.write(
      `Usage: pnpm beta:invite [--days 1..${BETA_INVITE_MAX_DAYS}] [--uses 1..100]\n`,
    );
    return;
  }
  const days = readInt(args, "--days", 7);
  const uses = readInt(args, "--uses", 1);
  if (days < 1 || days > BETA_INVITE_MAX_DAYS) {
    process.stderr.write(
      `--days must be between 1 and ${BETA_INVITE_MAX_DAYS}.\n`,
    );
    process.exit(2);
  }
  if (uses < 1 || uses > 100) {
    process.stderr.write("--uses must be between 1 and 100.\n");
    process.exit(2);
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    process.stderr.write("DATABASE_URL is not set; no invite created.\n");
    process.exit(1);
  }
  configureLocalNeon(url);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const now = new Date();
    const db = drizzle({ client: pool, schema }) as unknown as BetaDb;
    const invite = await createBetaInvite(db, {
      expiresAt: new Date(now.getTime() + days * 86_400_000),
      maxUses: uses,
      now,
    });
    process.stdout.write(
      [
        `Beta invite ${invite.id}`,
        `Code (shown once, not stored): ${invite.code}`,
        `Uses: ${invite.maxUses}`,
        `Expires: ${invite.expiresAt.toISOString()}`,
        "",
      ].join("\n"),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // Print the class only; connection errors can embed the connection string.
  process.stderr.write(
    `Beta invite creation failed: ${error instanceof Error ? error.name : "unknown error"}\n`,
  );
  process.exit(1);
});
