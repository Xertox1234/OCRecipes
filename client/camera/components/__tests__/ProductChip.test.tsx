// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProductChip } from "../ProductChip";
import type { ScanPhase } from "../../types/scan-phase";

const noop = () => {};

const handlers = {
  onConfirm: noop,
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
const step2Confirmed: ScanPhase = {
  type: "STEP2_CONFIRMED",
  barcode: "123",
  nutritionImageUri: "x",
  ocrText: "",
};
const step2Review: ScanPhase = {
  type: "STEP2_REVIEWING",
  barcode: "123",
  imageUri: "x",
  ocrText: "Calories 200",
};
const step3Review: ScanPhase = {
  type: "STEP3_REVIEWING",
  barcode: "123",
  nutritionImageUri: "x",
  ocrText: "",
  frontImageUri: "y",
};

describe("ProductChip — barcode_lock / step2_confirmed have no secondary capture button", () => {
  it("barcode_lock renders exactly one button (the shutter, not this chip, captures the next photo)", () => {
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/point at the nutrition facts/i)).toBeTruthy();
  });

  it("step2_confirmed renders exactly one button", () => {
    render(<ProductChip phase={step2Confirmed} {...handlers} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/point at the front/i)).toBeTruthy();
  });
});

describe("ProductChip — step2_review / step3_review auto-advance treatment", () => {
  it("renders a single tappable review card (no separate Confirm/Edit buttons) when no screen reader is active", () => {
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        screenReaderEnabled={false}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/nutrition label captured/i)).toBeTruthy();
  });

  it("review card has proper accessibility label indicating it can be tapped to edit", () => {
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        screenReaderEnabled={false}
      />,
    );
    expect(screen.getByLabelText(/nutrition label captured/i)).toBeTruthy();
  });

  it("falls back to the explicit Confirm/Edit buttons when a screen reader is active", () => {
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        screenReaderEnabled={true}
      />,
    );
    expect(screen.getByText("Looks right →")).toBeTruthy();
    expect(screen.getByText("Edit values")).toBeTruthy();
  });

  it("step3_review also gets the single tappable review card by default", () => {
    render(
      <ProductChip
        phase={step3Review}
        {...handlers}
        screenReaderEnabled={false}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/front label captured/i)).toBeTruthy();
  });
});
