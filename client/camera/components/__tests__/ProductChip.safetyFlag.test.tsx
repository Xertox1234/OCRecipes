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
const lockedPhase = (safetyFlag?: any): ScanPhase => ({
  type: "BARCODE_LOCKED",
  barcode: "12345",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  product: { name: "Trail Mix", safetyFlag },
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
});
