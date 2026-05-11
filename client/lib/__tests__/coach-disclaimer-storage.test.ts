import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  COACH_DISCLAIMER_STORAGE_KEY,
  isCoachDisclaimerDismissed,
  setCoachDisclaimerDismissed,
} from "../coach-disclaimer-storage";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

describe("coach-disclaimer-storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isCoachDisclaimerDismissed", () => {
    it("returns false when no value has been persisted", async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);
      const dismissed = await isCoachDisclaimerDismissed();
      expect(dismissed).toBe(false);
      expect(mockAsyncStorage.getItem).toHaveBeenCalledWith(
        COACH_DISCLAIMER_STORAGE_KEY,
      );
    });

    it("returns true when persisted value is the string 'true'", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("true");
      const dismissed = await isCoachDisclaimerDismissed();
      expect(dismissed).toBe(true);
    });

    it("returns false for any non-'true' persisted value", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("false");
      expect(await isCoachDisclaimerDismissed()).toBe(false);

      mockAsyncStorage.getItem.mockResolvedValue("1");
      expect(await isCoachDisclaimerDismissed()).toBe(false);

      mockAsyncStorage.getItem.mockResolvedValue("");
      expect(await isCoachDisclaimerDismissed()).toBe(false);
    });

    it("returns false (safe default — show disclaimer) when AsyncStorage rejects", async () => {
      mockAsyncStorage.getItem.mockRejectedValue(new Error("storage failure"));
      const dismissed = await isCoachDisclaimerDismissed();
      expect(dismissed).toBe(false);
    });
  });

  describe("setCoachDisclaimerDismissed", () => {
    it("persists 'true' under the documented key", async () => {
      mockAsyncStorage.setItem.mockResolvedValue(undefined);
      await setCoachDisclaimerDismissed();
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        COACH_DISCLAIMER_STORAGE_KEY,
        "true",
      );
    });

    it("swallows AsyncStorage write errors", async () => {
      mockAsyncStorage.setItem.mockRejectedValue(new Error("write failed"));
      await expect(setCoachDisclaimerDismissed()).resolves.toBeUndefined();
    });
  });

  describe("storage key contract", () => {
    it("uses the exact documented key string", () => {
      expect(COACH_DISCLAIMER_STORAGE_KEY).toBe(
        "@ocrecipes/coach_disclaimer_dismissed",
      );
    });
  });
});
