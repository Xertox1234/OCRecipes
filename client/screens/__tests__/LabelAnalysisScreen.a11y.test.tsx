// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import * as RN from "react-native";
import { FadeInUp } from "react-native-reanimated";
import { renderComponent } from "../../../test/utils/render-component";
import LabelAnalysisScreen from "../LabelAnalysisScreen";

const {
  mockGoBack,
  mockPop,
  mockNavigate,
  mockReplace,
  mockApiRequest,
  mockUpload,
  mockRoute,
  mockReducedMotion,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockPop: vi.fn(),
  mockNavigate: vi.fn(),
  mockReplace: vi.fn(),
  mockApiRequest: vi.fn(),
  mockUpload: vi.fn(),
  mockRoute: { params: {} as Record<string, unknown> },
  mockReducedMotion: { current: false },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    pop: mockPop,
    navigate: mockNavigate,
    replace: mockReplace,
  }),
  useRoute: () => mockRoute,
}));

vi.mock("@react-navigation/elements", () => ({
  useHeaderHeight: () => 0,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({
    reducedMotion: mockReducedMotion.current,
    screenReaderEnabled: false,
  }),
}));

vi.mock("@/lib/query-client", () => ({ apiRequest: mockApiRequest }));

vi.mock("@/lib/photo-upload", () => ({
  uploadLabelForAnalysis: mockUpload,
  confirmLabelAnalysis: vi.fn(),
}));

// LabelAnalysisScreen deletes its captured temp photo on unmount — the real
// module hits a native module at import time under jsdom.
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: vi.fn().mockResolvedValue(undefined),
}));

const BARCODE = "0778918011332";
const IMAGE_URI = "file:///label-capture.jpg";

const DEFAULT_LABEL_DATA = {
  servingSize: "1 cup",
  servingsPerContainer: 2,
  calories: 250,
  totalFat: 10,
  saturatedFat: 2,
  transFat: 0,
  cholesterol: 5,
  sodium: 300,
  totalCarbs: 30,
  dietaryFiber: 3,
  totalSugars: 12,
  addedSugars: 5,
  protein: 8,
  vitaminD: null,
  calcium: null,
  iron: null,
  potassium: null,
  confidence: 0.9,
};

// A real, high-confidence local OCR fixture (parseNutritionFromOCR confidence
// >= 0.9 — see client/lib/__tests__/nutrition-ocr-parser.test.ts, "extracts
// all fields from a standard US nutrition label"). Using the real parser
// output (rather than a hand-written LabelExtractionResult) is what actually
// exercises the local-preview -> AI-replaces path this suite needs.
const LOCAL_OCR_TEXT = `Nutrition Facts
Serving Size 1 cup (228g)
Servings Per Container 2
Calories 250
Total Fat 12g
  Saturated Fat 3g
  Trans Fat 0g
Cholesterol 30mg
Sodium 470mg
Total Carbohydrate 31g
  Dietary Fiber 0g
  Total Sugars 5g
Protein 5g`;

// >10% off calories vs. the local parse (250) — shouldReplaceWithAI (>10% on
// any of calories/totalFat/protein/totalCarbs/sodium) fires, so the screen
// replaces the local preview with this AI data and shows the "Updated with
// AI analysis" toast.
const AI_REPLACEMENT_LABEL_DATA = {
  ...DEFAULT_LABEL_DATA,
  calories: 400,
  confidence: 0.95,
};

describe("LabelAnalysisScreen — accessibility announcements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReducedMotion.current = false;
    mockRoute.params = { imageUri: IMAGE_URI, barcode: BARCODE };
    mockUpload.mockResolvedValue({
      sessionId: "session-1",
      labelData: DEFAULT_LABEL_DATA,
    });
  });

  describe("error state", () => {
    it("renders the error via InlineError (announced on both platforms) once the upload fails", async () => {
      const announce = vi
        .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
        .mockImplementation(() => {});
      // Rejecting with a plain Error (not an ApiError) takes the generic
      // branch — no local data exists, so this is the full-screen error path.
      mockUpload.mockRejectedValue(new Error("network down"));

      const { container } = renderComponent(<LabelAnalysisScreen />);

      const errorText = await screen.findByText(
        "Couldn't read this label. Try again with better lighting.",
      );

      // Android half: InlineError's own accessibilityRole="alert" +
      // accessibilityLiveRegion="assertive" maps to role="alert" + aria-live
      // in this harness (test/mocks/react-native.ts's mockComponent).
      const alertNode = screen.getByRole("alert");
      expect(alertNode.contains(errorText)).toBe(true);
      expect(alertNode.getAttribute("aria-live")).toBe("assertive");

      // iOS half: InlineError's internal Platform.OS === "ios" gated
      // announceForAccessibility (Platform.OS defaults to "ios" in this
      // harness's react-native mock).
      expect(announce).toHaveBeenCalledWith(
        "Couldn't read this label. Try again with better lighting.",
      );
      // Exactly once: a second same-commit announce would collide on iOS.
      expect(announce).toHaveBeenCalledTimes(1);

      // The decorative alert-circle icon this screen used to render itself
      // (unhidden, 48px) is gone — InlineError owns the icon and already
      // hides it (accessible={false}), so there is exactly one alert-circle
      // icon left: InlineError's own.
      expect(
        container.querySelectorAll('[data-icon="alert-circle"]').length,
      ).toBe(1);
    });
  });

  describe("verification result", () => {
    function renderVerification() {
      mockRoute.params = {
        imageUri: IMAGE_URI,
        barcode: BARCODE,
        verificationMode: true,
        verifyBarcode: BARCODE,
      };
      return renderComponent(<LabelAnalysisScreen />);
    }

    it("announces the match result once and hides the decorative icon", async () => {
      const announce = vi
        .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
        .mockImplementation(() => {});
      mockApiRequest.mockResolvedValue({
        json: async () => ({
          verified: true,
          isMatch: true,
          verificationLevel: "single_verified",
          verificationCount: 2,
          canScanFrontLabel: false,
        }),
      });
      const { container } = renderVerification();

      const submit = await screen.findByText("Submit Verification");

      // Negative control: the match-result string has not been spoken before
      // the user submits (the mount-time "Ready to submit verification"
      // announce is a different string, asserted separately below).
      expect(announce).not.toHaveBeenCalledWith(
        "Thanks for verifying! (2/3 confirmations)",
      );

      await act(async () => {
        fireEvent.click(submit);
      });

      await screen.findByText("Thanks for verifying! (2/3 confirmations)");
      const matchCalls = announce.mock.calls.filter(
        (call) => call[0] === "Thanks for verifying! (2/3 confirmations)",
      );
      expect(matchCalls.length).toBe(1);

      // Decorative check-circle icon is hidden from the a11y tree (mapped to
      // aria-hidden via test/mocks/expo-vector-icons.ts's ariaHiddenProps).
      const icon = container.querySelector('[data-icon="check-circle"]');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
    });

    it("announces the mismatch result with the static copy", async () => {
      const announce = vi
        .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
        .mockImplementation(() => {});
      mockApiRequest.mockResolvedValue({
        json: async () => ({
          verified: true,
          isMatch: false,
          verificationLevel: "single_verified",
          verificationCount: 1,
          canScanFrontLabel: false,
        }),
      });
      const { container } = renderVerification();

      const submit = await screen.findByText("Submit Verification");
      await act(async () => {
        fireEvent.click(submit);
      });

      await screen.findByText(
        "Values differ from other scans. We've recorded your data.",
      );
      expect(announce).toHaveBeenCalledWith(
        "Values differ from other scans. We've recorded your data.",
      );

      const icon = container.querySelector('[data-icon="info"]');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
    });

    it("does not re-announce the result on an unrelated re-render", async () => {
      const announce = vi
        .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
        .mockImplementation(() => {});
      mockApiRequest.mockResolvedValue({
        json: async () => ({
          verified: true,
          isMatch: true,
          verificationLevel: "single_verified",
          verificationCount: 1,
          canScanFrontLabel: false,
        }),
      });
      const { rerender } = renderVerification();

      const submit = await screen.findByText("Submit Verification");
      await act(async () => {
        fireEvent.click(submit);
      });
      await screen.findByText("Thanks for verifying! (1/3 confirmations)");

      const countAfterFirst = announce.mock.calls.filter(
        (call) => call[0] === "Thanks for verifying! (1/3 confirmations)",
      ).length;
      expect(countAfterFirst).toBe(1);

      rerender(<LabelAnalysisScreen />);

      const countAfterRerender = announce.mock.calls.filter(
        (call) => call[0] === "Thanks for verifying! (1/3 confirmations)",
      ).length;
      expect(countAfterRerender).toBe(1);
    });
  });

  describe('"Updated with AI analysis" toast', () => {
    it("hides the toast's decorative check icon from screen readers", async () => {
      mockRoute.params = {
        imageUri: IMAGE_URI,
        barcode: BARCODE,
        localOCRText: LOCAL_OCR_TEXT,
      };
      mockUpload.mockResolvedValue({
        sessionId: "session-1",
        labelData: AI_REPLACEMENT_LABEL_DATA,
      });

      renderComponent(<LabelAnalysisScreen />);

      const text = await screen.findByText("Updated with AI analysis");
      const toast = text.parentElement!;
      const icon = toast.querySelector('[data-icon="check-circle"]');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
    });

    it("announces the update merged with the ready-to-log announce (same-commit iOS collision guard), and respects reduced motion", async () => {
      mockRoute.params = {
        imageUri: IMAGE_URI,
        barcode: BARCODE,
        localOCRText: LOCAL_OCR_TEXT,
      };
      mockUpload.mockResolvedValue({
        sessionId: "session-1",
        labelData: AI_REPLACEMENT_LABEL_DATA,
      });
      const announce = vi
        .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
        .mockImplementation(() => {});
      const durationSpy = vi.spyOn(FadeInUp, "duration");

      renderComponent(<LabelAnalysisScreen />);

      await screen.findByText("Updated with AI analysis");

      // sessionId and showUpdatedToast are set synchronously one after the
      // other in the same async continuation (no `await` between them), so
      // React batches both into ONE commit — on iOS, two separate
      // announceForAccessibility calls in the same tick would collide and
      // one gets dropped (docs/solutions/logic-errors/
      // two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md).
      // The fix folds them into a single combined utterance.
      expect(announce).toHaveBeenCalledWith(
        "Updated with AI analysis. Ready to log",
      );
      expect(announce).toHaveBeenCalledTimes(1);

      // Not reduced motion (default) — the toast's entering animation is
      // built via FadeInUp.duration(200), called directly (not chained off
      // .delay(), which the macro-row stagger elsewhere on this screen
      // uses) — see test/mocks/react-native-reanimated.ts's shared chainable
      // mock (delay()/duration() return the SAME instance either way, so
      // .duration(200) is the distinguishing call args, not the identity).
      expect(durationSpy).toHaveBeenCalledWith(200);
    });

    it("skips the toast's entrance animation when reducedMotion is true", async () => {
      mockReducedMotion.current = true;
      mockRoute.params = {
        imageUri: IMAGE_URI,
        barcode: BARCODE,
        localOCRText: LOCAL_OCR_TEXT,
      };
      mockUpload.mockResolvedValue({
        sessionId: "session-1",
        labelData: AI_REPLACEMENT_LABEL_DATA,
      });
      const durationSpy = vi.spyOn(FadeInUp, "duration");

      renderComponent(<LabelAnalysisScreen />);

      // The render is the denominator: without confirming the toast (and
      // therefore its entering prop) actually mounted, a call count of zero
      // would be meaningless (a clean zero needs its denominator).
      await screen.findByText("Updated with AI analysis");

      expect(durationSpy).not.toHaveBeenCalled();
    });

    it("still announces plain 'Ready to log' when no local preview exists (no toast, unmerged path unaffected)", async () => {
      const announce = vi
        .spyOn(RN.AccessibilityInfo, "announceForAccessibility")
        .mockImplementation(() => {});

      renderComponent(<LabelAnalysisScreen />);

      await waitFor(() => expect(mockUpload).toHaveBeenCalled());
      await waitFor(() =>
        expect(announce).toHaveBeenCalledWith("Ready to log"),
      );
      expect(screen.queryByText("Updated with AI analysis")).toBeNull();
    });
  });
});
