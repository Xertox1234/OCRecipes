// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
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
});
