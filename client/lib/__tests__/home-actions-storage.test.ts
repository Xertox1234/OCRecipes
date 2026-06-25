import {
  initHomeActionsCache,
  getSectionState,
  setSectionExpanded,
  getRecentActions,
  pushRecentAction,
  getActionUsageCounts,
  clearHomeActionsState,
} from "../home-actions-storage";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

describe("home-actions-storage", () => {
  beforeEach(() => {
    // Mock isolation: clearAllMocks wipes call history AND any per-test
    // mockImplementation, then the mockReturnValue lines below re-establish fresh
    // defaults — so a race test's custom getItem/removeItem impl never leaks forward.
    // NOTE: the module-under-test's own state (sweepEpoch, sweepInFlight, the caches)
    // is intentionally NOT reset between tests — the static top-level imports bind to a
    // single module instance, so a vi.resetModules() here would be a no-op without
    // converting every test to dynamic import. This is safe because sweepEpoch is only
    // ever compared RELATIVELY within one init lifecycle (startEpoch vs current), never
    // against an absolute, and every test calls initHomeActionsCache() before asserting
    // on the getters. A future test that interleaves init/clear must not assume a
    // starting epoch of 0.
    vi.clearAllMocks();
    mockAsyncStorage.getItem.mockReturnValue(Promise.resolve(null));
    mockAsyncStorage.setItem.mockReturnValue(Promise.resolve());
    mockAsyncStorage.removeItem.mockReturnValue(Promise.resolve());
  });

  describe("initHomeActionsCache", () => {
    it("initializes with defaults when storage is empty", async () => {
      await initHomeActionsCache("user-1");

      const sections = getSectionState();
      expect(sections.scanning).toBe(true);
      expect(sections.nutrition).toBe(true);
      expect(sections.recipes).toBe(true);
      expect(sections.planning).toBe(true);

      expect(getRecentActions()).toEqual([]);
    });

    it("restores saved section state", async () => {
      mockAsyncStorage.getItem.mockImplementation((key: string) => {
        if (key === "@ocrecipes_home_sections") {
          return Promise.resolve(
            JSON.stringify({ scanning: false, nutrition: true }),
          );
        }
        return Promise.resolve(null);
      });

      await initHomeActionsCache("user-1");

      const sections = getSectionState();
      expect(sections.scanning).toBe(false);
      expect(sections.nutrition).toBe(true);
      // Defaults for unset keys
      expect(sections.recipes).toBe(true);
    });

    it("restores saved recent actions", async () => {
      mockAsyncStorage.getItem.mockImplementation((key: string) => {
        if (key === "@ocrecipes_recent_actions") {
          return Promise.resolve(JSON.stringify(["scan-barcode", "quick-log"]));
        }
        // The durable-owner marker must match the init user for history to load.
        if (key === "@ocrecipes_durable_owner") {
          return Promise.resolve("user-1");
        }
        return Promise.resolve(null);
      });

      await initHomeActionsCache("user-1");
      expect(getRecentActions()).toEqual(["scan-barcode", "quick-log"]);
    });

    it("handles corrupted JSON gracefully", async () => {
      mockAsyncStorage.getItem.mockReturnValue(Promise.resolve("{bad json"));

      await initHomeActionsCache("user-1");

      // Falls back to defaults
      const sections = getSectionState();
      expect(sections.scanning).toBe(true);
      expect(getRecentActions()).toEqual([]);
    });
  });

  describe("setSectionExpanded", () => {
    it("persists section state to AsyncStorage", async () => {
      await initHomeActionsCache("user-1");
      await setSectionExpanded("scanning", false);

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        "@ocrecipes_home_sections",
        expect.stringContaining('"scanning":false'),
      );

      expect(getSectionState().scanning).toBe(false);
    });
  });

  describe("pushRecentAction", () => {
    it("adds action to front of list", async () => {
      await initHomeActionsCache("user-1");
      await pushRecentAction("scan-barcode");

      expect(getRecentActions()).toEqual(["scan-barcode"]);
    });

    it("deduplicates actions", async () => {
      await initHomeActionsCache("user-1");
      await pushRecentAction("scan-barcode");
      await pushRecentAction("quick-log");
      await pushRecentAction("scan-barcode");

      expect(getRecentActions()).toEqual(["scan-barcode", "quick-log"]);
    });

    it("limits to 4 recent actions", async () => {
      await initHomeActionsCache("user-1");
      await pushRecentAction("a");
      await pushRecentAction("b");
      await pushRecentAction("c");
      await pushRecentAction("d");
      await pushRecentAction("e");

      const recent = getRecentActions();
      expect(recent).toHaveLength(4);
      expect(recent[0]).toBe("e");
    });

    it("persists to AsyncStorage", async () => {
      await initHomeActionsCache("user-1");
      await pushRecentAction("scan-barcode");

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        "@ocrecipes_recent_actions",
        JSON.stringify(["scan-barcode"]),
      );
    });
  });

  describe("clearHomeActionsState", () => {
    it("clears recent actions and usage counts from memory and disk, retaining section prefs", async () => {
      mockAsyncStorage.getItem.mockImplementation((key: string) => {
        if (key === "@ocrecipes_recent_actions")
          return Promise.resolve(JSON.stringify(["ai-coach", "quick-log"]));
        if (key === "@ocrecipes_action_usage_counts")
          return Promise.resolve(JSON.stringify({ "quick-log": 3 }));
        if (key === "@ocrecipes_home_sections")
          return Promise.resolve(JSON.stringify({ scanning: false }));
        // Owner marker matches so the history loads (then clear wipes it).
        if (key === "@ocrecipes_durable_owner")
          return Promise.resolve("user-1");
        return Promise.resolve(null);
      });
      await initHomeActionsCache("user-1");
      expect(getRecentActions()).toEqual(["ai-coach", "quick-log"]);
      expect(getActionUsageCounts()).toEqual({ "quick-log": 3 });

      await clearHomeActionsState();

      // Memory caches reset to empty defaults (the synchronous getters back the
      // Home UI, so leaving these populated leaks the prior user's history).
      expect(getRecentActions()).toEqual([]);
      expect(getActionUsageCounts()).toEqual({});
      // Disk keys removed.
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
        "@ocrecipes_recent_actions",
      );
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
        "@ocrecipes_action_usage_counts",
      );
      // Section state is a device-display pref, intentionally NOT cleared.
      expect(mockAsyncStorage.removeItem).not.toHaveBeenCalledWith(
        "@ocrecipes_home_sections",
      );
      expect(getSectionState().scanning).toBe(false);
    });

    it("returns true when both disk removals succeed (confirmed wipe)", async () => {
      await initHomeActionsCache("user-1");
      await expect(clearHomeActionsState()).resolves.toBe(true);
    });

    it("returns false (unconfirmed wipe) when a removeItem fails, without throwing", async () => {
      mockAsyncStorage.removeItem.mockImplementation((k: string) =>
        k === "@ocrecipes_recent_actions"
          ? Promise.reject(new Error("disk full"))
          : Promise.resolve(),
      );
      await initHomeActionsCache("user-1");
      // Non-throwing contract preserved, but reports the failure so the
      // durable-owner marker won't advance past this user.
      await expect(clearHomeActionsState()).resolves.toBe(false);
    });

    it("does not resurrect a swept history when init's read races clearHomeActionsState", async () => {
      // A prior session's history is on disk. On a shared device, the teardown
      // sweep must win even when it collides with a Home-mount init that already
      // read disk — otherwise the prior user's recent/frequent actions resurface
      // in the in-memory caches (which the sync getters return) under the next user.
      const disk: Record<string, string | null> = {
        "@ocrecipes_recent_actions": JSON.stringify(["A1", "A2"]),
        "@ocrecipes_action_usage_counts": JSON.stringify({ A1: 3 }),
      };
      mockAsyncStorage.removeItem.mockImplementation(async (k: string) => {
        disk[k] = null;
      });
      // Defer init's recent-actions read so the sweep interleaves between init's
      // read and its cache-populate — the exact resurrection window.
      let resolveRecent: (v: string | null) => void = () => {};
      mockAsyncStorage.getItem.mockImplementation((k: string) => {
        if (k === "@ocrecipes_recent_actions")
          return new Promise<string | null>((r) => {
            resolveRecent = r;
          });
        return Promise.resolve(disk[k] ?? null);
      });

      const initP = initHomeActionsCache("user-1"); // suspends at the deferred read
      const clearP = clearHomeActionsState(); // must serialize AFTER init
      resolveRecent(JSON.stringify(["A1", "A2"])); // init "read" the prior data

      await Promise.all([initP, clearP]);

      // The in-memory assertions are the load-bearing regression guard: without
      // the epoch check (init commits only when sweepEpoch is unchanged), a late
      // init repopulates these caches with the prior user's data (proven by the
      // mutation check). The disk assertions are belt-and-suspenders — init never
      // setItem, so removeItem nulls disk regardless.
      expect(getRecentActions()).toEqual([]);
      expect(getActionUsageCounts()).toEqual({});
      expect(disk["@ocrecipes_recent_actions"]).toBeNull();
      expect(disk["@ocrecipes_action_usage_counts"]).toBeNull();
    });

    it("does not resurrect a swept history when a fresh init starts during clear's removeItem", async () => {
      // The mirror of the test above: clear runs FIRST (bumping the epoch + nulling
      // the caches synchronously, then suspending on removeItem), and only THEN does a
      // fresh Home-mount init begin. The init must wait out the in-flight sweep before
      // reading disk — otherwise it reads pre-wipe stale history and repopulates the
      // in-memory caches the sync getters return to the next user's Home UI.
      const disk: Record<string, string | null> = {
        "@ocrecipes_recent_actions": JSON.stringify(["B1", "B2"]),
        "@ocrecipes_action_usage_counts": JSON.stringify({ B1: 5 }),
      };
      // Defer removeItem so the sweep is still "in flight" when init starts — the exact
      // mirror window. Gating disk-null behind the resolver means a non-waiting init
      // would read the stale values still on disk.
      let resolveRemove: () => void = () => {};
      const removeGate = new Promise<void>((r) => {
        resolveRemove = r;
      });
      mockAsyncStorage.removeItem.mockImplementation(async (k: string) => {
        await removeGate;
        disk[k] = null;
      });
      // Lazy getItem: snapshots disk[k] at CALL time, so an init that reads BEFORE
      // removeItem lands gets stale data (what the in-flight-sweep wait must prevent).
      mockAsyncStorage.getItem.mockImplementation((k: string) =>
        Promise.resolve(disk[k] ?? null),
      );

      const clearP = clearHomeActionsState(); // epoch++, caches null, suspends on removeItem
      const initP = initHomeActionsCache("user-1"); // must await the in-flight sweep before reading
      resolveRemove(); // removeItem lands → disk wiped → sweep settles → init reads empty

      await Promise.all([clearP, initP]);

      // Without the sweepInFlight wait, init reads stale ["B1","B2"] and commits it
      // here (proven by the mutation check); with it, init reads the wiped disk.
      expect(getRecentActions()).toEqual([]);
      expect(getActionUsageCounts()).toEqual({});
      expect(disk["@ocrecipes_recent_actions"]).toBeNull();
      expect(disk["@ocrecipes_action_usage_counts"]).toBeNull();
    });
  });
});

// Cross-RESTART durability (the residual the in-memory sweepEpoch/sweepInFlight
// guards can't cover). vi.resetModules() in beforeEach gives each test a FRESH
// module instance with sweepEpoch back to 0 and null caches — a faithful app
// restart — so any protection here comes from the persisted durable-owner marker,
// not the in-memory race guards. A test that skipped resetModules would only
// exercise those guards and prove nothing about durability across a relaunch.
describe("initHomeActionsCache — durable-owner gate (cross-restart)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);
  });

  it("does not resurrect a prior user's history when a failed wipe leaves it on disk and a DIFFERENT user inits after restart", async () => {
    // User A's logout wipe FAILED, so A's history survives on disk and the marker
    // still names A. After a restart, user B's Home mount must read empty.
    const disk: Record<string, string | null> = {
      "@ocrecipes_recent_actions": JSON.stringify(["A1", "A2"]),
      "@ocrecipes_action_usage_counts": JSON.stringify({ A1: 9 }),
      "@ocrecipes_durable_owner": "user-A",
    };
    mockAsyncStorage.getItem.mockImplementation((k: string) =>
      Promise.resolve(disk[k] ?? null),
    );
    const { initHomeActionsCache, getRecentActions, getActionUsageCounts } =
      await import("../home-actions-storage");

    await initHomeActionsCache("user-B");

    expect(getRecentActions()).toEqual([]);
    expect(getActionUsageCounts()).toEqual({});
  });

  it("loads history when the durable-owner marker matches the active user", async () => {
    const disk: Record<string, string | null> = {
      "@ocrecipes_recent_actions": JSON.stringify(["mine"]),
      "@ocrecipes_action_usage_counts": JSON.stringify({ mine: 2 }),
      "@ocrecipes_durable_owner": "user-A",
    };
    mockAsyncStorage.getItem.mockImplementation((k: string) =>
      Promise.resolve(disk[k] ?? null),
    );
    const { initHomeActionsCache, getRecentActions, getActionUsageCounts } =
      await import("../home-actions-storage");

    await initHomeActionsCache("user-A");

    expect(getRecentActions()).toEqual(["mine"]);
    expect(getActionUsageCounts()).toEqual({ mine: 2 });
  });

  it("does not load legacy history written before the marker existed (absent owner → one-time reset)", async () => {
    const disk: Record<string, string | null> = {
      "@ocrecipes_recent_actions": JSON.stringify(["legacy"]),
      // No @ocrecipes_durable_owner key — a pre-upgrade install.
    };
    mockAsyncStorage.getItem.mockImplementation((k: string) =>
      Promise.resolve(disk[k] ?? null),
    );
    const { initHomeActionsCache, getRecentActions } = await import(
      "../home-actions-storage"
    );

    await initHomeActionsCache("user-A");

    expect(getRecentActions()).toEqual([]);
  });
});
