import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { termsAcceptances } from "@/server/db/schema";
import type { TermsAcceptanceRow, TermsStore } from "./terms";

/** Terms acceptances in Postgres (migration 0004). */
export function dbTermsStore(db: Database): TermsStore {
  return {
    async insert(row) {
      await db
        .insert(termsAcceptances)
        .values(row)
        .onConflictDoNothing({
          target: [
            termsAcceptances.wallet,
            termsAcceptances.termsVersion,
            termsAcceptances.termsHash,
          ],
        });
    },
    async accepted(wallet, version, hash) {
      const rows = await db
        .select({ id: termsAcceptances.id })
        .from(termsAcceptances)
        .where(
          and(
            eq(termsAcceptances.wallet, wallet),
            eq(termsAcceptances.termsVersion, version),
            eq(termsAcceptances.termsHash, hash),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
}

/** In-process store: unit tests and a local-fork E2E run without Postgres only. */
export function memoryTermsStore(): TermsStore & {
  rows: TermsAcceptanceRow[];
} {
  const rows: TermsAcceptanceRow[] = [];
  return {
    rows,
    async insert(row) {
      if (rows.some((r) => r.nonce === row.nonce))
        throw new Error("duplicate nonce");
      if (
        rows.some(
          (r) =>
            r.wallet === row.wallet &&
            r.termsVersion === row.termsVersion &&
            r.termsHash === row.termsHash,
        )
      )
        return;
      rows.push(row);
    },
    async accepted(wallet, version, hash) {
      return rows.some(
        (r) =>
          r.wallet === wallet &&
          r.termsVersion === version &&
          r.termsHash === hash,
      );
    },
  };
}
