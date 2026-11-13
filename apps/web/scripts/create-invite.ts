// Creates one creator invite and prints its code ONCE. Only the SHA-256 of the code is stored.
// Usage (from apps/web, DATABASE_URL in the environment):
//   pnpm exec tsx scripts/create-invite.ts [--days 7] [--uses 1]
// Invites always expire (at most 90 days) and are single-use unless --uses says otherwise.
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schema";
import { createInvite, INVITE_MAX_DAYS } from "../features/creators/invites";

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
      `Usage: tsx scripts/create-invite.ts [--days 1..${INVITE_MAX_DAYS}] [--uses 1..100]\n`,
    );
    return;
  }
  const days = readInt(args, "--days", 7);
  const uses = readInt(args, "--uses", 1);
  if (days < 1 || days > INVITE_MAX_DAYS) {
    process.stderr.write(`--days must be between 1 and ${INVITE_MAX_DAYS}.\n`);
    process.exit(2);
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    process.stderr.write("DATABASE_URL is not set; no invite created.\n");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const now = new Date();
    const invite = await createInvite(drizzle({ client: pool, schema }), {
      expiresAt: new Date(now.getTime() + days * 86_400_000),
      maxUses: uses,
      now,
    });
    process.stdout.write(
      [
        `Invite ${invite.id}`,
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
    `Invite creation failed: ${error instanceof Error ? error.name : "unknown error"}\n`,
  );
  process.exit(1);
});
