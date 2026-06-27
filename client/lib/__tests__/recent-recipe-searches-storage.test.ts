import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  initRecentSearchesCache,
  getRecentSearches,
  pushRecentSearch,
  clearRecentSearches,
} from "../recent-recipe-searches-storage";

// In-memory AsyncStorage double — a Map standing in for the device's disk.
const store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: vi.fn(async (k: string) => void store.delete(k)),
  },
}));

// getDurableOwner() returns the durable-owner MARKER — the user id the on-disk
// stores are confirmed clean-for. Cross-user bleed is prevented by comparing this
// marker to the active user, NOT by the teardown wipe succeeding.
let ownerValue: string | null = "user-1";
vi.mock("@/lib/durable-owner", () => ({
  getDurableOwner: vi.fn(async () => ownerValue),
}));

beforeEach(() => {
  store.clear();
  ownerValue = "user-1";
});

describe("recent-recipe-searches-storage", () => {
  it("dedupes case-insensitively, newest first", async () => {
    await initRecentSearchesCache("user-1");
    await pushRecentSearch("pasta");
    await pushRecentSearch("salad");
    await pushRecentSearch("PASTA"); // dedupe vs "pasta" (still in window)
    // The old "pasta" is removed and "PASTA" moves to the front — proves the
    // case-insensitive filter actually fires (mutating it would change this).
    expect(getRecentSearches()).toEqual(["PASTA", "salad"]);
  });

  it("caps the list at 8, dropping the oldest", async () => {
    await initRecentSearchesCache("user-1");
    for (const q of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) {
      await pushRecentSearch(q);
    }
    const recent = getRecentSearches();
    expect(recent.length).toBe(8);
    expect(recent[0]).toBe("i"); // newest first
    expect(recent).not.toContain("a"); // oldest evicted
  });

  it("ignores empty / whitespace-only queries", async () => {
    await initRecentSearchesCache("user-1");
    await pushRecentSearch("   ");
    await pushRecentSearch("");
    expect(getRecentSearches()).toEqual([]);
  });

  it("does NOT surface another user's history when the owner marker doesn't match (cross-user bleed guard)", async () => {
    // user-1 used the app: disk holds their search, owner marker = user-1.
    await initRecentSearchesCache("user-1");
    await pushRecentSearch("pasta");
    expect(getRecentSearches()).toEqual(["pasta"]);

    // user-2 becomes active but the durable-owner marker still says user-1
    // (a real cross-user switch where the confirmed teardown wipe hasn't run or
    // failed). The on-disk history is NOT user-2's — it must not surface.
    // ownerValue intentionally stays "user-1": the marker has NOT advanced.
    await initRecentSearchesCache("user-2");
    expect(getRecentSearches()).toEqual([]);
  });

  it("DOES restore the same user's history when the owner marker matches", async () => {
    // Proves the guard discriminates (it doesn't just always return empty):
    // a matching owner across a fresh init reloads from disk.
    await initRecentSearchesCache("user-1");
    await pushRecentSearch("pasta");
    await initRecentSearchesCache("user-1"); // simulate relaunch, owner still user-1
    expect(getRecentSearches()).toContain("pasta");
  });

  it("treats a null (unauthenticated) user as owning nothing", async () => {
    await initRecentSearchesCache("user-1");
    await pushRecentSearch("pasta");
    await initRecentSearchesCache(null);
    expect(getRecentSearches()).toEqual([]);
  });

  it("clear wipes cache and disk, returns true", async () => {
    await initRecentSearchesCache("user-1");
    await pushRecentSearch("pasta");
    const ok = await clearRecentSearches();
    expect(ok).toBe(true);
    expect(getRecentSearches()).toEqual([]);
    expect(store.has("@ocrecipes_recent_recipe_searches")).toBe(false);
  });
});
