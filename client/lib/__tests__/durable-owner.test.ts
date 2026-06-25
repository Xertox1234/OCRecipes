import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  AUTH_STORAGE_KEY,
  getActiveUserId,
  getDurableOwner,
  reconcileDurableOwner,
} from "../durable-owner";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

const OWNER_KEY = "@ocrecipes_durable_owner";

describe("durable-owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    mockAsyncStorage.removeItem.mockResolvedValue(undefined);
  });

  describe("storage key contract", () => {
    it("uses the documented auth-blob key (drift here silently breaks the drain gate)", () => {
      expect(AUTH_STORAGE_KEY).toBe("@ocrecipes_auth");
    });
  });

  describe("getDurableOwner", () => {
    it("returns the persisted owner id", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("user-A");
      expect(await getDurableOwner()).toBe("user-A");
      expect(mockAsyncStorage.getItem).toHaveBeenCalledWith(OWNER_KEY);
    });

    it("returns null (safe default) when AsyncStorage rejects", async () => {
      mockAsyncStorage.getItem.mockRejectedValue(new Error("disk"));
      expect(await getDurableOwner()).toBeNull();
    });
  });

  describe("getActiveUserId", () => {
    it("reads the auth blob and returns the id as a string", async () => {
      mockAsyncStorage.getItem.mockImplementation((key: string) =>
        Promise.resolve(
          key === AUTH_STORAGE_KEY
            ? JSON.stringify({ id: 7, username: "x" })
            : null,
        ),
      );
      expect(await getActiveUserId()).toBe("7");
    });

    it("returns null when the blob is absent", async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);
      expect(await getActiveUserId()).toBeNull();
    });

    it("returns null on a corrupt blob (never throws)", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("{not-json");
      expect(await getActiveUserId()).toBeNull();
    });
  });

  describe("reconcileDurableOwner", () => {
    it("no-ops when the marker already names this user (wipe not called)", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("user-A");
      const wipe = vi.fn().mockResolvedValue(true);

      await reconcileDurableOwner("user-A", wipe);

      expect(wipe).not.toHaveBeenCalled();
      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it("wipes and advances the marker on a mismatch when the wipe is confirmed", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("user-A"); // prior owner
      const wipe = vi.fn().mockResolvedValue(true);

      await reconcileDurableOwner("user-B", wipe);

      expect(wipe).toHaveBeenCalledOnce();
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        OWNER_KEY,
        "user-B",
      );
    });

    it("wipes on an absent marker (legacy/first run) and adopts the user", async () => {
      mockAsyncStorage.getItem.mockResolvedValue(null);
      const wipe = vi.fn().mockResolvedValue(true);

      await reconcileDurableOwner("user-B", wipe);

      expect(wipe).toHaveBeenCalledOnce();
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        OWNER_KEY,
        "user-B",
      );
    });

    it("does NOT advance the marker when the wipe is not confirmed (retry next time)", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("user-A");
      const wipe = vi.fn().mockResolvedValue(false); // a removeItem failed

      await reconcileDurableOwner("user-B", wipe);

      expect(wipe).toHaveBeenCalledOnce();
      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });

    it("never throws when the wipe throws", async () => {
      mockAsyncStorage.getItem.mockResolvedValue("user-A");
      const wipe = vi.fn().mockRejectedValue(new Error("boom"));

      await expect(
        reconcileDurableOwner("user-B", wipe),
      ).resolves.toBeUndefined();
      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });
  });
});
