import { describe, expect, it } from "vitest";
import {
  clearDraft,
  DRAFT_KEY,
  EMPTY_DRAFT,
  loadDraft,
  saveDraft,
} from "./draft";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const throwing = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
  removeItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
};

const draft = {
  ...EMPTY_DRAFT,
  name: "Chips",
  ticker: "CHIP",
  allocations: [
    {
      mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
      symbol: "AAPLx",
      weightBps: 10_000,
    },
  ],
};

describe("builder draft storage", () => {
  it("round-trips a draft with its save time", () => {
    const store = memory();
    expect(loadDraft(store)).toEqual({ state: "empty" });
    expect(saveDraft(draft, new Date("2026-11-13T12:00:00Z"), store)).toBe(
      true,
    );
    expect(loadDraft(store)).toEqual({
      state: "loaded",
      draft: { ...draft, savedAt: "2026-11-13T12:00:00.000Z" },
    });
    expect(clearDraft(store)).toBe(true);
    expect(loadDraft(store)).toEqual({ state: "empty" });
  });

  it("treats corrupted or tampered drafts as invalid, never as data", () => {
    const store = memory();
    store.data.set(DRAFT_KEY, "{not json");
    expect(loadDraft(store).state).toBe("invalid");
    store.data.set(
      DRAFT_KEY,
      JSON.stringify({
        ...draft,
        savedAt: "x",
        allocations: [{ mint: "bad", symbol: "X", weightBps: 1.5 }],
      }),
    );
    expect(loadDraft(store).state).toBe("invalid");
  });

  it("never throws when storage is blocked or full", () => {
    expect(loadDraft(throwing)).toEqual({ state: "unavailable" });
    expect(saveDraft(draft, new Date(), throwing)).toBe(false);
    expect(clearDraft(throwing)).toBe(false);
    expect(loadDraft(null)).toEqual({ state: "unavailable" });
    expect(saveDraft(draft, new Date(), null)).toBe(false);
    expect(clearDraft(null)).toBe(false);
  });
});
