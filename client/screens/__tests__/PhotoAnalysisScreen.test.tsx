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
