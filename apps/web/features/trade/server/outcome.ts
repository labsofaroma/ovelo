import "server-only";
import type { SubmitDeps } from "./submit";

/**
 * What became of a submitted authorization, for settling a W3 cap reservation that is still
 * open after its resolve time. "open" whenever it cannot be decided (the amount keeps counting:
 * fail closed). Read-only RPC calls only.
 * - no record: the request was never claimed, so nothing was broadcast → failed;
 * - a signature confirmed or finalized without error → confirmed; with an error → failed;
 * - no status anywhere and the chain is past the blockhash's last valid height → it can never
 *   land → failed (expired unconfirmed).
 */
export async function tradeOutcome(
  requestId: string,
  deps: Pick<SubmitDeps, "store" | "rpc">,
): Promise<"confirmed" | "failed" | "open"> {
  const record = await deps.store.get(requestId);
  if (!record) return "failed";
  if (record.status === "confirmed") return "confirmed";
  if (record.status === "failed") return "failed";
  try {
    const statuses = await deps.rpc<{
      value: ({ err: unknown; confirmationStatus: string | null } | null)[];
    }>("getSignatureStatuses", [
      record.signatures,
      { searchTransactionHistory: true },
    ]);
    const values = statuses.value ?? [];
    if (values.some((s) => s?.err)) return "failed";
    if (
      values.some((s) =>
        ["confirmed", "finalized"].includes(s?.confirmationStatus ?? ""),
      )
    )
      return "confirmed";
    if (values.some((s) => s !== null)) return "open";
    const height = await deps.rpc<number>("getBlockHeight", [
      { commitment: "finalized" },
    ]);
    return height > record.lastValidBlockHeight ? "failed" : "open";
  } catch {
    return "open";
  }
}
