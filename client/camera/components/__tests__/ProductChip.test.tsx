// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import * as ProductChipUtils from "../ProductChip-utils";
import { ProductChip } from "../ProductChip";
import type { ScanPhase } from "../../types/scan-phase";

const noop = () => {};

const handlers = {
  onConfirm: noop,
  onProceedToLabel: noop,
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

describe("ProductChip — step2_confirmed has no secondary capture button", () => {
  it("step2_confirmed renders exactly one button", () => {
    render(<ProductChip phase={step2Confirmed} {...handlers} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/point at the front/i)).toBeTruthy();
  });
});

// barcode_lock's primary control must ADVANCE the flow — it used to be
// "Looks right →" wired to CONFIRM_PRODUCT (a skip), with the only route to
// step 2 an unlabeled implicit gesture in caption text. Both actions are now
// real, labelled buttons: see getBarcodeLockActions in ProductChip-utils.ts.
describe("ProductChip — barcode_lock offers two real actions, not a skip-only primary", () => {
  it("renders two buttons: primary advances to the label step, secondary is the barcode-only escape hatch", () => {
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("Scan Nutrition Facts →")).toBeTruthy();
    expect(screen.getByText("Use database data anyway")).toBeTruthy();
  });

  it("tapping the primary action calls onProceedToLabel when the product is unverified", () => {
    let called = false;
    render(
      <ProductChip
        phase={barcodeLock}
        {...handlers}
        onProceedToLabel={() => {
          called = true;
        }}
      />,
    );
    screen.getByText("Scan Nutrition Facts →").click();
    expect(called).toBe(true);
  });

  it("tapping the secondary action calls onConfirm when the product is unverified", () => {
    let called = false;
    render(
      <ProductChip
        phase={barcodeLock}
        {...handlers}
        onConfirm={() => {
          called = true;
        }}
      />,
    );
    screen.getByText("Use database data anyway").click();
    expect(called).toBe(true);
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

  it("tapping the review card calls onEditStep2", () => {
    let called = false;
    render(
      <ProductChip
        phase={step2Review}
        {...handlers}
        onEditStep2={() => {
          called = true;
        }}
        screenReaderEnabled={false}
      />,
    );
    screen.getByRole("button").click();
    expect(called).toBe(true);
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

// Wiring-seam check: getShutterClearanceStyle's own derivation is unit-tested
// in ProductChip-utils.test.ts, but that proves nothing about whether this
// component still calls it, or calls it with the right arguments — the gap
// docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md
// warns about. Assert the component threads insets.bottom through on every
// render, and that session_complete is no longer a special case (P2-2026-07-15:
// it used to be excluded, which left the overlap unresolved for that phase
// and caused a jump-cut on the transition into it).
describe("ProductChip — shutter-clearance wiring", () => {
  const sessionComplete: ScanPhase = {
    type: "SESSION_COMPLETE",
    barcode: "123",
  };

  it("calls getShutterClearanceStyle with insets.bottom", () => {
    const spy = vi.spyOn(ProductChipUtils, "getShutterClearanceStyle");
    render(<ProductChip phase={barcodeLock} {...handlers} />);
    expect(spy).toHaveBeenCalledWith(0);
    spy.mockRestore();
  });

  it("calls getShutterClearanceStyle identically for session_complete — no more flush-bottom exception", () => {
    const spy = vi.spyOn(ProductChipUtils, "getShutterClearanceStyle");
    render(<ProductChip phase={sessionComplete} {...handlers} />);
    expect(spy).toHaveBeenCalledWith(0);
    spy.mockRestore();
  });
});
