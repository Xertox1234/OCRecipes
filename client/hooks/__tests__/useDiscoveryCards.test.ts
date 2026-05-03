// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useDiscoveryCards } from "../useDiscoveryCards";

const { mockInitDiscoveryCache, mockGetDismissedCardIds, mockDismissCard } =
  vi.hoisted(() => ({
    mockInitDiscoveryCache: vi.fn(),
    mockGetDismissedCardIds: vi.fn(),
    mockDismissCard: vi.fn(),
  }));

vi.mock("@/lib/discovery-storage", () => ({
  initDiscoveryCache: mockInitDiscoveryCache,
  getDismissedCardIds: mockGetDismissedCardIds,
  dismissCard: mockDismissCard,
}));

describe("useDiscoveryCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitDiscoveryCache.mockResolvedValue(undefined);
    mockGetDismissedCardIds.mockReturnValue(new Set<string>());
    mockDismissCard.mockResolvedValue(undefined);
  });

  it("returns scan-receipt card when usageCounts is empty", async () => {
    const { result } = renderHook(() => useDiscoveryCards({}));
    await waitFor(() =>
      expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
        true,
      ),
    );
  });

  it("shows a card when usageCounts explicitly contains zero for that id", async () => {
    const { result } = renderHook(() =>
      useDiscoveryCards({ "scan-receipt": 0 }),
    );
    await waitFor(() =>
      expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
        true,
      ),
    );
  });

  it("hides a card when its usageCounts entry is greater than zero", async () => {
    const { result } = renderHook(() =>
      useDiscoveryCards({ "scan-receipt": 2 }),
    );
    await waitFor(() =>
      expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
        false,
      ),
    );
  });

  it("hides a card immediately after dismiss() is called", async () => {
    const { result } = renderHook(() => useDiscoveryCards({}));
    await waitFor(() =>
      expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
        true,
      ),
    );

    await act(async () => {
      await result.current.dismiss("scan-receipt");
    });

    expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
      false,
    );
    expect(mockDismissCard).toHaveBeenCalledWith("scan-receipt");
  });

  it("returns empty array when all 10 cards have been dismissed", async () => {
    const allDismissed = new Set([
      "scan-receipt",
      "photo-food-log",
      "scan-menu",
      "scan-nutrition-label",
      "batch-scan",
      "meal-plan",
      "grocery-list",
      "pantry",
      "generate-recipe",
      "import-recipe",
    ]);
    mockGetDismissedCardIds.mockReturnValue(allDismissed);
    const { result } = renderHook(() => useDiscoveryCards({}));
    await waitFor(() => expect(result.current.cards).toHaveLength(0));
  });

  it("returns empty array when all 10 cards have been used", async () => {
    const allUsed = Object.fromEntries(
      [
        "scan-receipt",
        "photo-food-log",
        "scan-menu",
        "scan-nutrition-label",
        "batch-scan",
        "meal-plan",
        "grocery-list",
        "pantry",
        "generate-recipe",
        "import-recipe",
      ].map((id) => [id, 1]),
    );
    const { result } = renderHook(() => useDiscoveryCards(allUsed));
    await waitFor(() => expect(result.current.cards).toHaveLength(0));
  });

  it("hides cards that were dismissed in a previous session", async () => {
    mockGetDismissedCardIds.mockReturnValue(new Set(["scan-receipt"]));
    const { result } = renderHook(() => useDiscoveryCards({}));
    await waitFor(() =>
      expect(result.current.cards.some((c) => c.id === "scan-receipt")).toBe(
        false,
      ),
    );
  });
});
