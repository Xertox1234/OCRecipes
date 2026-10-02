// @vitest-environment jsdom
//
// HistoryScreen had no test at all: importing it threw `SyntaxError: Unexpected
// token 'typeof'` (todo P2-2026-09-26 history-screen-not-importable-in-test-
// harness). This pins the screen's loading-skeleton screen-reader signal (todo
// P2-2026-09-23 skeleton-loaders-screen-reader-busy-state): both skeleton render
// sites are hidden from the accessibility tree, and the delayed "Loading"
// announcement is keyed on `isLoading && !isError`. The announcement's own
// timing is covered by client/hooks/__tests__/useDelayedLoadingAnnouncement.test.ts
// — this file pins only the screen's wiring of it.
//
// `@react-navigation/bottom-tabs`, `@react-navigation/elements`,
// `react-native-safe-area-context` and `react-native-reanimated` are globally
// aliased (vitest.config.mts) — only the screen's data hook and its two modal
// children need a local mock. UpgradeModal is stubbed the way ScanScreen.test.tsx
// does: it pulls in @/lib/iap's runtime `require("./mock-iap")`, which Vite's
// module graph can't resolve, and it has its own tests.
import React from "react";
import { screen } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { LOADING_ANNOUNCEMENT_DELAY_MS } from "@/hooks/useDelayedLoadingAnnouncement";
import type { useHistoryData } from "@/hooks/useHistoryData";
import HistoryScreen from "../HistoryScreen";

type HistoryData = ReturnType<typeof useHistoryData>;

const { mockUseHistoryData } = vi.hoisted(() => ({
  mockUseHistoryData: vi.fn(),
}));

vi.mock("@/hooks/useHistoryData", () => ({
  useHistoryData: mockUseHistoryData,
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

vi.mock("@/components/GroceryListPickerModal", () => ({
  GroceryListPickerModal: () => null,
}));

const ERROR_ANNOUNCEMENT = "Couldn't load your history. Try again.";

/**
 * Hook state for the loading/error branches — every other field the screen
 * destructures is unread there, so it stays undefined. `displayItems` is read
 * unconditionally by the list branch.
 */
function historyState(overrides: Partial<HistoryData> = {}) {
  return {
    showAll: false,
    isLoading: true,
    isError: false,
    displayItems: [],
    ...overrides,
  };
}

describe("HistoryScreen — loading skeleton screen-reader signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("hides the dashboard skeleton from screen readers as one unit", () => {
    mockUseHistoryData.mockReturnValue(historyState({ showAll: false }));
    renderComponent(<HistoryScreen />);

    const list = screen.getByTestId("skeleton-list");
    // DashboardSkeleton's own root View has no testID; the list sits directly
    // inside it, so its parent is the region that hides the stats/CTA/header
    // boxes the list itself doesn't cover.
    expect(list.parentElement?.getAttribute("aria-hidden")).toBe("true");
    expect(list.getAttribute("aria-hidden")).toBe("true");
  });

  it("hides the full-history skeleton from screen readers", () => {
    mockUseHistoryData.mockReturnValue(historyState({ showAll: true }));
    renderComponent(<HistoryScreen />);

    // Exactly one: the FlatList's ListEmptyComponent skeleton, not the
    // dashboard one.
    const lists = screen.getAllByTestId("skeleton-list");
    expect(lists).toHaveLength(1);
    expect(lists[0].getAttribute("aria-hidden")).toBe("true");
  });

  it.each([
    { site: "dashboard", showAll: false },
    { site: "full-history", showAll: true },
  ])(
    "announces Loading once after the delay on the $site skeleton, not synchronously",
    ({ showAll }) => {
      const announceSpy = vi.spyOn(
        RN.AccessibilityInfo,
        "announceForAccessibility",
      );
      try {
        mockUseHistoryData.mockReturnValue(historyState({ showAll }));
        renderComponent(<HistoryScreen />);

        expect(announceSpy).not.toHaveBeenCalledWith("Loading");

        vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS);

        expect(announceSpy).toHaveBeenCalledExactlyOnceWith("Loading");
      } finally {
        announceSpy.mockRestore();
      }
    },
  );

  // isLoading and isError come from two independent queries (useHistoryData),
  // so an error can land while the other query is still loading. Without the
  // `!isError` gate the screen would announce the failure and then, when the
  // timer elapses, a stale "Loading".
  it("does not announce a stale Loading when an error arrives first", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      mockUseHistoryData.mockReturnValue(historyState());
      const { rerender } = renderComponent(<HistoryScreen />);
      vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS / 2);

      mockUseHistoryData.mockReturnValue(historyState({ isError: true }));
      rerender(<HistoryScreen />);
      vi.advanceTimersByTime(LOADING_ANNOUNCEMENT_DELAY_MS);

      // Presence first: the error IS announced, so the spy is wired to the
      // screen and the isError transition was processed — which is what makes
      // the "Loading" absence below mean something.
      expect(announceSpy).toHaveBeenCalledExactlyOnceWith(ERROR_ANNOUNCEMENT);
      expect(announceSpy).not.toHaveBeenCalledWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });
});

// The screen tests above mock useHistoryData, so they never load its import
// graph. These pin the harness fixes that make that graph importable — each
// import threw before (`Unexpected token 'typeof'` from the REAL react-native
// entry via the externalized @react-navigation packages; `Cannot find module
// './setupFastRefresh'` via expo-notifications).
describe("HistoryScreen harness — the real data-path imports load", () => {
  it("loads @react-navigation/native", async () => {
    const actual = await import("@react-navigation/native");
    expect(actual.useNavigation).toBeDefined();
  });

  it("loads @react-navigation/bottom-tabs", async () => {
    const actual = await import("@react-navigation/bottom-tabs");
    expect(actual.BottomTabBarHeightContext).toBeDefined();
  });

  it("loads @/context/AuthContext and @/context/PremiumContext", async () => {
    const auth = await import("@/context/AuthContext");
    const premium = await import("@/context/PremiumContext");
    expect(auth.useAuthContext).toBeDefined();
    expect(premium.usePremiumContext).toBeDefined();
  });

  it("loads the real useHistoryData", async () => {
    const actual = await vi.importActual<
      typeof import("@/hooks/useHistoryData")
    >("@/hooks/useHistoryData");
    expect(actual.useHistoryData).toBeDefined();
  });
});
