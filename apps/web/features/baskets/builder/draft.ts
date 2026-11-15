import { z } from "zod";
import {
  BPS_TOTAL,
  DESCRIPTION_MAX,
  MAX_LEGS,
  mintSchema,
  NAME_MAX,
} from "../../creators/schema";

/**
 * The builder's draft lives in this browser only (M5a has no wallet, so nothing is sent to the
 * server). Every storage access is wrapped: private mode, blocked site data or a full quota must
 * never break the page; the builder then says the draft is not being saved.
 */

export const DRAFT_KEY = "ovelo.v1.basketBuilder.draft";

export const builderDraftSchema = z.object({
  v: z.literal(1),
  name: z.string().max(NAME_MAX * 2),
  ticker: z.string().max(30),
  description: z.string().max(DESCRIPTION_MAX * 2),
  allocations: z
    .array(
      z.object({
        mint: mintSchema,
        symbol: z.string().max(32),
        weightBps: z.number().int().min(0).max(BPS_TOTAL),
      }),
    )
    .max(MAX_LEGS),
  savedAt: z.string(),
});
export type BuilderDraft = z.infer<typeof builderDraftSchema>;

export const EMPTY_DRAFT: Omit<BuilderDraft, "savedAt"> = {
  v: 1,
  name: "",
  ticker: "",
  description: "",
  allocations: [],
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export type LoadResult =
  | { state: "empty" }
  | { state: "loaded"; draft: BuilderDraft }
  | { state: "invalid" }
  | { state: "unavailable" };

export function loadDraft(store: StorageLike | null = storage()): LoadResult {
  if (!store) return { state: "unavailable" };
  let raw: string | null;
  try {
    raw = store.getItem(DRAFT_KEY);
  } catch {
    return { state: "unavailable" };
  }
  if (raw === null) return { state: "empty" };
  try {
    const parsed = builderDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { state: "loaded", draft: parsed.data }
      : { state: "invalid" };
  } catch {
    return { state: "invalid" };
  }
}

/** Returns false when the browser refused to store it. */
export function saveDraft(
  draft: Omit<BuilderDraft, "savedAt">,
  now: Date = new Date(),
  store: StorageLike | null = storage(),
): boolean {
  if (!store) return false;
  try {
    store.setItem(
      DRAFT_KEY,
      JSON.stringify({ ...draft, savedAt: now.toISOString() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(store: StorageLike | null = storage()): boolean {
  if (!store) return false;
  try {
    store.removeItem(DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}
