// @vitest-environment jsdom
/**
 * ProductChip announce-model rework
 * (todo P3-2026-06-23-smart-scan-chip-live-region-announce-model-rework):
 *
 * The chip dropped its container `accessibilityLiveRegion="polite"` because a
 * single shared polite region re-read the WHOLE chip subtree on the
 * smart-confirm `Text↔ActivityIndicator` busy swap (emulator-confirmed). Screen-
 * reader cues are now driven imperatively per transition via
 * `AccessibilityInfo.announceForAccessibility` on BOTH platforms.
 *
 * These tests lock the new model at the JS level: no container live region, and
 * an announce fires on appear AND on non-null→non-null transitions on iOS and
 * Android alike. The per-variant TalkBack *speech* behaviour is the todo's
 * empirical acceptance criterion and is verified on the Android emulator, not
 * here. See docs/rules/accessibility.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import * as RN from "react-native";
import { ProductChip } from "../ProductChip";
import type { ScanPhase } from "../../types/scan-phase";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";

const noop = () => {};

const handlers = {
  onConfirm: noop,
  onAddNutritionPhoto: noop,
  onAddFrontPhoto: noop,
  onStepConfirmed: noop,
  onEditStep2: noop,
  onEditStep3: noop,
  onSmartPhotoConfirm: noop,
  onRetry: noop,
};

const barcodeLock: ScanPhase = {
  type: "BARCODE_LOCKED",
  barcode: "123",
  bounds: { x: 0.4, y: 0.45, width: 0.2, height: 0.1 },
};
// Same phase type as `barcodeLock` with the async-loaded product attached —
// models the BARCODE_LOCKED → PRODUCT_LOADED in-place update (variant unchanged).
const barcodeLockWithProduct: ScanPhase = {
  type: "BARCODE_LOCKED",
  barcode: "123",
  bounds: { x: 0.4, y: 0.45, width: 0.2, height: 0.1 },
  product: { name: "Test Cola", brand: "Acme", imageUri: undefined },
};
const step2Review: ScanPhase = {
  type: "STEP2_REVIEWING",
  barcode: "123",
  imageUri: "x",
  ocrText: "",
};
const step2Confirmed: ScanPhase = {
  type: "STEP2_CONFIRMED",
  barcode: "123",
  nutritionImageUri: "x",
  ocrText: "",
};
const smartPhoto: ScanPhase = {
  type: "SMART_CONFIRMED",
  imageUri: "x",
  // Only the fields ProductChip reads (foods, contentType, overallConfidence);
  // cast through unknown since the full PhotoAnalysisResponse has more required
  // fields the chip never touches.
  classification: {
    foods: [],
    contentType: "restaurant_menu",
    overallConfidence: 0.9,
  } as unknown as PhotoAnalysisResponse,
};
const idle: ScanPhase = { type: "IDLE" };

const PLATFORMS = ["ios", "android"] as const;

describe("ProductChip — announce model (rework)", () => {
  const originalOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    RN.Platform.OS = originalOS;
    announceSpy.mockRestore();
  });

  it("renders no container live region (no aria-live in the subtree)", () => {
    // The over-announcement this rework fixes came from a polite live region on
    // the shared container — it must be gone so the busy swap can't re-read the
    // chip. (Android is the only platform that honoured it.)
    RN.Platform.OS = "android";
    const { container } = render(
      <ProductChip phase={barcodeLock} {...handlers} />,
    );
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it.each(PLATFORMS)("announces the variant on appear (%s)", (os) => {
    RN.Platform.OS = os;
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    expect(announceSpy).toHaveBeenCalledWith(
      "Product found, tap to view details",
    );
  });

  // The regression-critical case: non-null→non-null transitions were announced
  // ONLY by the Android live region before (iOS heard nothing). Both platforms
  // must now announce, and no variant may go silent.
  it.each(PLATFORMS)("announces a non-null→non-null transition (%s)", (os) => {
    RN.Platform.OS = os;
    const { rerender } = render(
      <ProductChip phase={step2Review} {...handlers} />,
    );
    announceSpy.mockClear(); // drop the appear announce; isolate the transition
    rerender(<ProductChip phase={step2Confirmed} {...handlers} />);
    expect(announceSpy).toHaveBeenCalledWith("Nutrition values confirmed");
  });

  it.each(PLATFORMS)(
    "announces the smart-confirm busy edge once and stays silent on clear (%s)",
    (os) => {
      RN.Platform.OS = os;
      const { rerender } = render(
        <ProductChip
          phase={smartPhoto}
          {...handlers}
          isSmartConfirming={false}
        />,
      );
      announceSpy.mockClear(); // drop the appear announce

      // idle→busy edge announces on BOTH platforms (was iOS-only before).
      rerender(
        <ProductChip
          phase={smartPhoto}
          {...handlers}
          isSmartConfirming={true}
        />,
      );
      expect(announceSpy).toHaveBeenCalledWith("Analyzing photo…");
      expect(announceSpy).toHaveBeenCalledTimes(1);

      // busy→idle clear is intentionally silent (abort path = user left).
      rerender(
        <ProductChip
          phase={smartPhoto}
          {...handlers}
          isSmartConfirming={false}
        />,
      );
      expect(announceSpy).toHaveBeenCalledTimes(1);
    },
  );

  // A product name that loads AFTER the chip is shown keeps the same `variant`
  // (BARCODE_LOCKED → PRODUCT_LOADED), so the variant effect won't re-fire. The
  // old container live region re-read the subtree (Android spoke the name); the
  // dedicated productName effect must keep announcing it on both platforms.
  it.each(PLATFORMS)(
    "announces an async-loaded product name within barcode_lock (%s)",
    (os) => {
      RN.Platform.OS = os;
      const { rerender } = render(
        <ProductChip phase={barcodeLock} {...handlers} />,
      );
      announceSpy.mockClear(); // drop the "Product found…" appear announce
      // PRODUCT_LOADED: same variant, product now present.
      rerender(<ProductChip phase={barcodeLockWithProduct} {...handlers} />);
      expect(announceSpy).toHaveBeenCalledWith("Test Cola");
      expect(announceSpy).toHaveBeenCalledTimes(1); // just the name, no re-read
    },
  );

  it.each(PLATFORMS)("does not announce when no chip is shown (%s)", (os) => {
    RN.Platform.OS = os;
    render(<ProductChip phase={idle} {...handlers} />);
    expect(announceSpy).not.toHaveBeenCalled();
  });
});
