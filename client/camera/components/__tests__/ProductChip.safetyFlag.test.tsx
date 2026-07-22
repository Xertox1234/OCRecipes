// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as RN from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import { ProductChip } from "@/camera/components/ProductChip";
import type { ScanPhase } from "@/camera/types/scan-phase";

// ProductChip uses react-native-reanimated / safe-area / vector-icons — covered
// by the repo's global vitest setup mocks (see other camera component tests). If
// reanimated makes this render flaky, extract the badge text into a
// ProductChip-utils helper and unit-test that instead.

const noop = () => {};
// Builds a phase carrying the given flag as `product.topFlag` — the badge's
// render source since Task 14 (ProductChip reads `topFlag`, the
// highest-severity flag across ALL kinds; `safetyFlag` on ProductSummary
// still exists but only drives ScanScreen's Phase-1 fail-dangerous haptic,
// it is no longer what this badge renders). The fixtures below are all
// allergen/safety-tier flags, so their rendered behavior is unchanged.
const lockedPhase = (flag?: any): ScanPhase => ({
  type: "BARCODE_LOCKED",
  barcode: "12345",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  product: { name: "Trail Mix", topFlag: flag },
});

describe("ProductChip safety flag", () => {
  it("renders the top safety flag on the locked chip", () => {
    const { getByText } = renderComponent(
      <ProductChip
        phase={lockedPhase({
          id: "allergen:tree_nuts",
          kind: "allergen",
          severity: "danger",
          tier: "safety",
          title: "Contains Tree Nuts",
        })}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    // The chip renders "⚠ {title}".
    expect(getByText("⚠ Contains Tree Nuts")).toBeTruthy();
  });

  it("renders no flag row when there is no safety flag", () => {
    const { queryByText } = renderComponent(
      <ProductChip
        phase={lockedPhase(undefined)}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    expect(queryByText(/Contains/)).toBeNull();
  });

  // Guards the flex-trap: `styles.productRow` is `flexDirection: "row"`, so a
  // badge accidentally nested inside it would render squished beside the name
  // instead of as a full-width banner above it. `getByText` alone can't catch
  // this (it passes either way) — assert the DOM containment directly.
  it("renders the badge as a sibling ABOVE the product row, not nested inside it", () => {
    const { getByText, container } = renderComponent(
      <ProductChip
        phase={lockedPhase({
          id: "allergen:tree_nuts",
          kind: "allergen",
          severity: "danger",
          tier: "safety",
          title: "Contains Tree Nuts",
        })}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    const badgeText = getByText("⚠ Contains Tree Nuts");
    const productRow = container.querySelector(
      '[style*="flex-direction: row"]',
    );
    expect(productRow).not.toBeNull();
    expect(productRow?.contains(badgeText)).toBe(false);
  });
});

// iOS gets no announcement from `accessibilityLiveRegion` (Android-only prop —
// see ProductChip.a11y.test.tsx and docs/rules/accessibility.md), so a severe
// flag arriving after the chip is already shown needs its own imperative
// announce on iOS, gated off on Android since the badge's own live region
// already covers that platform (mirrors the productName pattern above it).
describe("ProductChip safety flag — accessibility", () => {
  const originalOS = RN.Platform.OS;
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    RN.Platform.OS = originalOS;
    announceSpy.mockRestore();
  });

  const dangerFlag = {
    id: "allergen:tree_nuts",
    kind: "allergen",
    severity: "danger",
    tier: "safety",
    title: "Contains Tree Nuts",
  };

  it("announces the flag imperatively on iOS when it loads async", () => {
    RN.Platform.OS = "ios";
    const { rerender } = renderComponent(
      <ProductChip
        phase={lockedPhase(undefined)}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    announceSpy.mockClear(); // drop the appear/name announces from mount
    rerender(
      <ProductChip
        phase={lockedPhase(dangerFlag)}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    expect(announceSpy).toHaveBeenCalledWith("Contains Tree Nuts");
  });

  it("does not imperatively announce on Android (the badge's live region already covers it)", () => {
    RN.Platform.OS = "android";
    const { rerender } = renderComponent(
      <ProductChip
        phase={lockedPhase(undefined)}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    announceSpy.mockClear();
    rerender(
      <ProductChip
        phase={lockedPhase(dangerFlag)}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    expect(announceSpy).not.toHaveBeenCalled();
  });

  // Regression for the iOS same-tick collision: productName and safetyFlag
  // arrive together in the same PRODUCT_LOADED commit. Two separate
  // `announceForAccessibility` calls in one JS tick makes VoiceOver drop one —
  // they must be folded into ONE combined utterance on iOS.
  it("combines name + flag into ONE announce on iOS when they arrive in the same commit", () => {
    RN.Platform.OS = "ios";
    // Mount with a product-LESS locked phase (no `product` key at all) — this
    // is the real reducer sequence: BARCODE_LOCKED always starts with no
    // product, and a later PRODUCT_LOADED dispatch adds name + flag together
    // in the SAME commit. `lockedPhase(undefined)` is NOT used for the mount
    // here because it bakes in `name: "Trail Mix"`, which would make the
    // mount itself carry a product and exercise the name-only branch instead
    // of the merge branch this test targets.
    const { rerender } = renderComponent(
      <ProductChip
        phase={{
          type: "BARCODE_LOCKED",
          barcode: "12345",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
        }}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    announceSpy.mockClear(); // drop the mount-time "Product found…" announce
    rerender(
      <ProductChip
        phase={lockedPhase(dangerFlag)}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    expect(announceSpy).toHaveBeenCalledWith("Trail Mix. Contains Tree Nuts");
    expect(announceSpy).not.toHaveBeenCalledWith("Trail Mix");
    expect(announceSpy).not.toHaveBeenCalledWith("Contains Tree Nuts");
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it("still announces only the name on Android when name+flag arrive together (badge live region covers the flag)", () => {
    RN.Platform.OS = "android";
    renderComponent(
      <ProductChip
        phase={lockedPhase(dangerFlag)}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    expect(announceSpy).toHaveBeenCalledWith("Trail Mix");
    expect(announceSpy).not.toHaveBeenCalledWith("Contains Tree Nuts");
    expect(announceSpy).not.toHaveBeenCalledWith(
      "Trail Mix. Contains Tree Nuts",
    );
  });
});
