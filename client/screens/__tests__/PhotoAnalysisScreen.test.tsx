// @vitest-environment jsdom
//
// P2-2026-09-23 (M15): PhotoAnalysisScreen's loading skeleton must be one
// hidden region (both platforms) with a delayed announce, not a container
// whose own accessibilityLabel is hidden along with the decorative boxes.
// No test file existed for this screen before this todo — this covers only
// the `isAnalyzing` loading branch, which reads `loadingText` off
// `usePhotoAnalysis` (everything else destructures as `undefined`, matching
// the branch's actual usage — see PhotoAnalysisScreen.tsx:394-461).
//
// `react-native-safe-area-context` and `@react-navigation/elements` (the
// source of `useHeaderHeight`) are globally aliased (vitest.config.mts) —
// only navigation/route and the screen's own data hook need a local mock.
import React from "react";
import { screen } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import PhotoAnalysisScreen from "../PhotoAnalysisScreen";
import { FadeInUp } from "react-native-reanimated";
import { listStaggerMaxIndex } from "@/constants/animations";

const { mockUsePhotoAnalysis } = vi.hoisted(() => ({
  mockUsePhotoAnalysis: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), goBack: vi.fn() }),
  useRoute: () => ({
    params: { imageUri: "file:///test.jpg", intent: "log" },
  }),
}));

vi.mock("@/hooks/usePhotoAnalysis", () => ({
  usePhotoAnalysis: mockUsePhotoAnalysis,
}));

function renderLoading() {
  mockUsePhotoAnalysis.mockReturnValue({
    isAnalyzing: true,
    loadingText: "Analyzing your photo...",
  });
  return renderComponent(<PhotoAnalysisScreen />);
}

describe("PhotoAnalysisScreen — loading skeleton screen-reader signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("renders the loading text passed through from the hook", () => {
    renderLoading();
    expect(screen.getByText("Analyzing your photo...")).toBeDefined();
  });

  it("hides the skeleton region from screen readers as one unit", () => {
    renderLoading();
    const region = screen.getByTestId("photo-analysis-loading-skeleton");
    expect(region.getAttribute("aria-hidden")).toBe("true");
  });

  // Fails on main: today the region itself carries `accessibilityLabel=
  // "Loading..."` alongside `accessibilityElementsHidden`, which hides the
  // label along with the decorative boxes on iOS.
  it("does not carry its own hidden Loading label", () => {
    renderLoading();
    expect(screen.queryByLabelText("Loading...")).toBeNull();
  });

  it("does not announce Loading synchronously, then announces it once after the modal-present delay", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      renderLoading();

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");

      vi.advanceTimersByTime(500);

      expect(announceSpy).toHaveBeenCalledExactlyOnceWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });

  it("does not announce a stale Loading when loading ends before the delay elapses", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      const { rerender } = renderLoading();
      vi.advanceTimersByTime(200);
      // Minimal empty-results shape: the screen's only early return is
      // isAnalyzing, so the results branch needs its collections present.
      mockUsePhotoAnalysis.mockReturnValue({
        isAnalyzing: false,
        loadingText: "Analyzing your photo...",
        foods: [],
        selectedFoods: [],
        selectedItems: new Set(),
        prepMethods: {},
        totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
        error: null,
        BeverageSheet: () => null,
        haptics: { impact: vi.fn(), notification: vi.fn(), selection: vi.fn() },
      });
      rerender(<PhotoAnalysisScreen />);
      vi.advanceTimersByTime(500);

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });

  it("cancels the pending Loading announce if the screen unmounts before the delay elapses", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      const { unmount } = renderLoading();
      unmount();
      vi.advanceTimersByTime(500);

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });
});

// The food cards slide in one after another, then the totals card. Both
// delays are capped, so a photo with many foods never leaves the totals card
// waiting long after the last visible item.
describe("PhotoAnalysisScreen — capped card entrance", () => {
  it("caps the item delays and the totals card delay together", () => {
    const delaySpy = vi.spyOn(FadeInUp, "delay");
    const count = listStaggerMaxIndex + 5;
    const foods = Array.from({ length: count }, (_, i) => ({
      name: `Food ${i}`,
      quantity: "1 cup",
      confidence: 0.9,
      nutrition: null,
    }));
    mockUsePhotoAnalysis.mockReturnValue({
      isAnalyzing: false,
      loadingText: "",
      analysisResult: { foods, overallConfidence: 0.9 },
      showNutrition: true,
      foods,
      selectedFoods: foods,
      selectedItems: new Set(),
      prepMethods: {},
      prepLoading: {},
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      error: null,
      BeverageSheet: () => null,
      haptics: { impact: vi.fn(), notification: vi.fn(), selection: vi.fn() },
    });
    renderComponent(<PhotoAnalysisScreen />);

    // The screen computes the totals delay before its item cards render, so
    // compare as a sorted multiset: count item cards + one totals card.
    const delays = delaySpy.mock.calls
      .map(([d]) => d as number)
      .sort((a, b) => a - b);
    const expected = [
      ...Array.from(
        { length: count },
        (_, i) => Math.min(i, listStaggerMaxIndex) * 100,
      ),
      listStaggerMaxIndex * 100 + 100,
    ].sort((a, b) => a - b);
    expect(delays).toEqual(expected);
    delaySpy.mockRestore();
  });
});
