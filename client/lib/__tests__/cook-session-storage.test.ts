import type { CookingSessionIngredient } from "@shared/types/cook-session";

import {
  saveCookSessionBackup,
  loadCookSessionBackup,
  clearCookSessionBackup,
} from "../cook-session-storage";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

/** Helper to create a minimal test ingredient. */
function makeIngredient(name: string): CookingSessionIngredient {
  return {
    id: `ing-${name}`,
    name,
    quantity: 1,
    unit: "piece",
    confidence: 0.9,
    category: "other",
    photoId: "photo-1",
    userEdited: false,
  };
}

describe("cook-session-storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);
  });

  describe("saveCookSessionBackup", () => {
    it("persists session data to AsyncStorage", async () => {
      const ingredients = [makeIngredient("Tomato")];

      await saveCookSessionBackup("sess-1", ingredients);

      expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
      const [key, value] = mockAsyncStorage.setItem.mock.calls[0];
      expect(key).toBe("cook_session_backup");

      const parsed = JSON.parse(value);
      expect(parsed.sessionId).toBe("sess-1");
      expect(parsed.ingredients).toHaveLength(1);
      expect(parsed.ingredients[0].name).toBe("Tomato");
      expect(typeof parsed.savedAt).toBe("number");
    });
  });

  describe("loadCookSessionBackup", () => {
    it("returns null when no backup exists", async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);

      const result = await loadCookSessionBackup();

      expect(result).toBeNull();
    });

    it("returns the saved backup when within TTL", async () => {
      const backup = {
        sessionId: "sess-1",
        ingredients: [makeIngredient("Flour")],
        savedAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago
      };
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(backup));

      const result = await loadCookSessionBackup();

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("sess-1");
      expect(result!.ingredients).toHaveLength(1);
    });

    it("returns null and clears storage for expired backups (>30 min)", async () => {
      const backup = {
        sessionId: "sess-old",
        ingredients: [makeIngredient("Stale")],
        savedAt: Date.now() - 31 * 60 * 1000, // 31 minutes ago
      };
      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(backup));

      const result = await loadCookSessionBackup();

      expect(result).toBeNull();
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
        "cook_session_backup",
      );
    });

    it("returns null and clears storage for corrupted JSON", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("{not valid json!!!");

      const result = await loadCookSessionBackup();

      expect(result).toBeNull();
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
        "cook_session_backup",
      );
    });
  });

  describe("clearCookSessionBackup", () => {
    it("removes the backup key from AsyncStorage", async () => {
      await clearCookSessionBackup();

      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith(
        "cook_session_backup",
      );
    });
  });

  describe("persistence — rapid state changes write sequentially", () => {
    it("multiple rapid saves result in multiple AsyncStorage.setItem calls", async () => {
      // The current implementation calls setItem on every save.
      // This test documents that behavior and verifies that each call
      // correctly reflects the latest state.
      const ingredients1 = [makeIngredient("Egg")];
      const ingredients2 = [makeIngredient("Egg"), makeIngredient("Flour")];
      const ingredients3 = [
        makeIngredient("Egg"),
        makeIngredient("Flour"),
        makeIngredient("Sugar"),
      ];

      await saveCookSessionBackup("sess-1", ingredients1);
      await saveCookSessionBackup("sess-1", ingredients2);
      await saveCookSessionBackup("sess-1", ingredients3);

      expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(3);

      // The last write should have all 3 ingredients
      const lastCallValue = mockAsyncStorage.setItem.mock.calls[2][1];
      const parsed = JSON.parse(lastCallValue);
      expect(parsed.ingredients).toHaveLength(3);
    });

    it("rapid saves always store the latest timestamp", async () => {
      const now = Date.now();
      vi.spyOn(Date, "now")
        .mockReturnValueOnce(now)
        .mockReturnValueOnce(now + 100)
        .mockReturnValueOnce(now + 200);

      await saveCookSessionBackup("sess-1", [makeIngredient("A")]);
      await saveCookSessionBackup("sess-1", [makeIngredient("B")]);
      await saveCookSessionBackup("sess-1", [makeIngredient("C")]);

      const calls = mockAsyncStorage.setItem.mock.calls;
      expect(JSON.parse(calls[0][1]).savedAt).toBe(now);
      expect(JSON.parse(calls[1][1]).savedAt).toBe(now + 100);
      expect(JSON.parse(calls[2][1]).savedAt).toBe(now + 200);

      vi.restoreAllMocks();
    });

    it("concurrent saves all complete (no data loss)", async () => {
      // Fire off saves without awaiting — all should eventually resolve
      const promises = Array.from({ length: 5 }, (_, i) =>
        saveCookSessionBackup(`sess-1`, [makeIngredient(`item-${i}`)]),
      );

      await Promise.all(promises);

      expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(5);
    });

    it("loadCookSessionBackup reads the most recent save correctly", async () => {
      // Simulate a save followed by a load
      const ingredients = [makeIngredient("Garlic"), makeIngredient("Onion")];
      const savedData = {
        sessionId: "sess-42",
        ingredients,
        savedAt: Date.now(),
      };

      mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(savedData));

      const result = await loadCookSessionBackup();

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("sess-42");
      expect(result!.ingredients).toHaveLength(2);
    });
  });
});
