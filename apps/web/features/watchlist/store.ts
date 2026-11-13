import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type StateStorage,
} from "zustand/middleware";
import { cleanMints, MAX_WATCHED, storedWatchlistSchema } from "./schema";

/**
 * Watchlist preferences (REWRITE-PLAN §3: Zustand, persisted, preferences only). Market data is
 * never stored here; the page asks the server for it. Per device, not synced.
 */
export const WATCHLIST_KEY = "aroma.v1.watchlist";
/** The prototype's key. Read once to import existing picks; never written. */
export const LEGACY_WATCHLIST_KEY = "aroma.watchlist.mainnet.v1";

function legacyMints(): string[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_WATCHLIST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? cleanMints(parsed) : [];
  } catch {
    return [];
  }
}

/** localStorage behind try/catch: blocked storage (private mode, policy, SSR) means "empty". */
export const safeStorage: StateStorage = {
  getItem(name) {
    try {
      const value = window.localStorage.getItem(name);
      if (value !== null || name !== WATCHLIST_KEY) return value;
      const imported = legacyMints();
      return imported.length
        ? JSON.stringify({ state: { mints: imported }, version: 1 })
        : null;
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Storage full or blocked: the choice lasts for this page view only.
    }
  },
  removeItem(name) {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};

export interface WatchlistState {
  mints: string[];
  hydrated: boolean;
  toggle: (mint: string) => void;
  remove: (mint: string) => void;
  markHydrated: () => void;
}

export const useWatchlist = create<WatchlistState>()(
  persist(
    (set, get) => ({
      mints: [],
      hydrated: false,
      toggle: (mint) => {
        const { mints } = get();
        set({
          mints: mints.includes(mint)
            ? mints.filter((item) => item !== mint)
            : cleanMints([...mints, mint]).slice(0, MAX_WATCHED),
        });
      },
      remove: (mint) =>
        set({ mints: get().mints.filter((item) => item !== mint) }),
      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: WATCHLIST_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ mints: state.mints }),
      // Stored data is untrusted: validate before it reaches state.
      merge: (persisted, current) => {
        const parsed = storedWatchlistSchema.safeParse(persisted);
        return parsed.success
          ? { ...current, mints: cleanMints(parsed.data.mints) }
          : current;
      },
      // Hydrate after mount (see useHydratedWatchlist) so server and first client render match.
      skipHydration: true,
      onRehydrateStorage: () => (state) => state?.markHydrated(),
    },
  ),
);
