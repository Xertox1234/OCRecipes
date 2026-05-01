import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  initDiscoveryCache,
  getDismissedCardIds,
  dismissCard,
} from "../discovery-storage";

const mockAsyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: mockAsyncStorage,
}));

describe("discovery-storage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    await initDiscoveryCache();
  });

  it("getDismissedCardIds returns empty set when no cards have been dismissed", () => {
    expect(getDismissedCardIds().size).toBe(0);
  });

  it("initDiscoveryCache with no prior data leaves dismissed set empty", async () => {
    await initDiscoveryCache();
    expect(getDismissedCardIds().size).toBe(0);
  });

  it("initDiscoveryCache hydrates from stored JSON", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(
      JSON.stringify(["scan-receipt", "pantry"]),
    );
    await initDiscoveryCache();
    const ids = getDismissedCardIds();
    expect(ids.has("scan-receipt")).toBe(true);
    expect(ids.has("pantry")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("dismissCard persists to AsyncStorage and updates in-memory cache", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    await initDiscoveryCache();

    await dismissCard("scan-receipt");

    expect(getDismissedCardIds().has("scan-receipt")).toBe(true);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      "@ocrecipes_dismissed_discovery_cards",
      JSON.stringify(["scan-receipt"]),
    );
  });

  it("dismissCard accumulates multiple dismissals without duplicates", async () => {
    mockAsyncStorage.getItem.mockResolvedValue(null);
    await initDiscoveryCache();

    await dismissCard("scan-receipt");
    await dismissCard("pantry");
    await dismissCard("scan-receipt");

    const ids = getDismissedCardIds();
    expect(ids.size).toBe(2);
    expect(ids.has("scan-receipt")).toBe(true);
    expect(ids.has("pantry")).toBe(true);
  });
});
