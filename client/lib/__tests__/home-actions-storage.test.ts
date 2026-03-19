import {
  initHomeActionsCache,
  getSectionState,
  setSectionExpanded,
  getRecentActions,
  pushRecentAction,
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
    vi.clearAllMocks();
    mockAsyncStorage.getItem.mockReturnValue(Promise.resolve(null));
    mockAsyncStorage.setItem.mockReturnValue(Promise.resolve());
  });

  describe("initHomeActionsCache", () => {
    it("initializes with defaults when storage is empty", async () => {
      await initHomeActionsCache();

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

      await initHomeActionsCache();

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
        return Promise.resolve(null);
      });

      await initHomeActionsCache();
      expect(getRecentActions()).toEqual(["scan-barcode", "quick-log"]);
    });

    it("handles corrupted JSON gracefully", async () => {
      mockAsyncStorage.getItem.mockReturnValue(Promise.resolve("{bad json"));

      await initHomeActionsCache();

      // Falls back to defaults
      const sections = getSectionState();
      expect(sections.scanning).toBe(true);
      expect(getRecentActions()).toEqual([]);
    });
  });

  describe("setSectionExpanded", () => {
    it("persists section state to AsyncStorage", async () => {
      await initHomeActionsCache();
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
      await initHomeActionsCache();
      await pushRecentAction("scan-barcode");

      expect(getRecentActions()).toEqual(["scan-barcode"]);
    });

    it("deduplicates actions", async () => {
      await initHomeActionsCache();
      await pushRecentAction("scan-barcode");
      await pushRecentAction("quick-log");
      await pushRecentAction("scan-barcode");

      expect(getRecentActions()).toEqual(["scan-barcode", "quick-log"]);
    });

    it("limits to 4 recent actions", async () => {
      await initHomeActionsCache();
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
      await initHomeActionsCache();
      await pushRecentAction("scan-barcode");

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        "@ocrecipes_recent_actions",
        JSON.stringify(["scan-barcode"]),
      );
    });
  });
});
