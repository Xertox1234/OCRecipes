// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { renderComponent } from "../../../../test/utils/render-component";
import { ProductChip } from "@/camera/components/ProductChip";
import { pickTopFlag, type ScanFlag } from "@shared/types/scan-flags";
import type { ScanPhase } from "@/camera/types/scan-phase";

// Task 14: the scan-lock chip surfaces the top flag across ALL kinds
// (allergen OR universal), not just Phase-1's safety-tier-only pick — e.g. an
// energy drink shows "High in caffeine" at lock time. Mirrors
// ProductChip.safetyFlag.test.tsx's structure/harness for the new `topFlag`
// field on ProductSummary.

const noop = () => {};
const lockedPhase = (topFlag?: ScanFlag): ScanPhase => ({
  type: "BARCODE_LOCKED",
  barcode: "12345",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  product: { name: "Energy Blast", topFlag },
});

const chipProps = {
  onConfirm: noop,
  onStepConfirmed: noop,
  onEditStep2: noop,
  onEditStep3: noop,
  onSmartPhotoConfirm: noop,
  onRetry: noop,
};

describe("ProductChip top flag (universal + allergen)", () => {
  it("renders a universal (non-allergen) flag on the scan-lock chip", () => {
    const caffeineFlag: ScanFlag = {
      id: "nutrient:caffeine",
      kind: "nutrient",
      nutrient: "caffeine",
      severity: "warn",
      tier: "nutrition",
      title: "High in caffeine",
    };
    const { getByText } = renderComponent(
      <ProductChip phase={lockedPhase(caffeineFlag)} {...chipProps} />,
    );
    expect(getByText("⚠ High in caffeine")).toBeTruthy();
  });

  // Runs the exact computation ScanScreen's fetchProductInfo performs on the
  // server's `flags[]` (pickTopFlag) before handing the result to the chip —
  // proves the allergen-wins-severity-tie behavior is wired all the way
  // through to what's rendered, not just correct inside pickTopFlag itself
  // (already unit-tested in shared/types/__tests__/scan-flags.test.ts).
  it("still shows the allergen flag over a same-severity universal flag (pickTopFlag tie-break)", () => {
    const nutrientWarn: ScanFlag = {
      id: "nutrient:sugar",
      kind: "nutrient",
      nutrient: "sugar",
      severity: "warn",
      tier: "nutrition",
      title: "High in sugar",
    };
    const allergenWarn: ScanFlag = {
      id: "allergen:milk",
      kind: "allergen",
      severity: "warn",
      tier: "safety",
      title: "Contains Milk",
    };
    const topFlag = pickTopFlag([nutrientWarn, allergenWarn]);

    const { getByText, queryByText } = renderComponent(
      <ProductChip phase={lockedPhase(topFlag)} {...chipProps} />,
    );
    expect(getByText("⚠ Contains Milk")).toBeTruthy();
    expect(queryByText(/High in sugar/)).toBeNull();
  });

  it("renders no flag row when there is no top flag", () => {
    const { queryByText } = renderComponent(
      <ProductChip phase={lockedPhase(undefined)} {...chipProps} />,
    );
    expect(queryByText(/⚠/)).toBeNull();
  });
});
