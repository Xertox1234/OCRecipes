// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoAdvanceTimer } from "../useAutoAdvanceTimer";
import type { ScanPhase } from "../../types/scan-phase";

const step2Reviewing: ScanPhase = {
  type: "STEP2_REVIEWING",
  barcode: "1",
  imageUri: "x",
  ocrText: "",
};
const step3Reviewing: ScanPhase = {
  type: "STEP3_REVIEWING",
  barcode: "1",
  nutritionImageUri: "x",
  ocrText: "",
  frontImageUri: "y",
};
const barcodeLocked: ScanPhase = {
  type: "BARCODE_LOCKED",
  barcode: "1",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
};

describe("useAutoAdvanceTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches STEP_CONFIRMED ~1s after entering STEP2_REVIEWING", () => {
    const dispatch = vi.fn();
    renderHook(() => useAutoAdvanceTimer(step2Reviewing, false, dispatch));

    expect(dispatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(dispatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "STEP_CONFIRMED" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches CONFIRM_PRODUCT ~1s after entering STEP3_REVIEWING", () => {
    const dispatch = vi.fn();
    renderHook(() => useAutoAdvanceTimer(step3Reviewing, false, dispatch));

    vi.advanceTimersByTime(1000);
    expect(dispatch).toHaveBeenCalledWith({ type: "CONFIRM_PRODUCT" });
  });

  it("does not schedule a timer for phases other than STEP2_REVIEWING/STEP3_REVIEWING", () => {
    const dispatch = vi.fn();
    renderHook(() => useAutoAdvanceTimer(barcodeLocked, false, dispatch));

    vi.advanceTimersByTime(5000);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not schedule a timer when a screen reader is active", () => {
    const dispatch = vi.fn();
    renderHook(() => useAutoAdvanceTimer(step2Reviewing, true, dispatch));

    vi.advanceTimersByTime(5000);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("cancels cleanly when the phase changes away before the timer fires (tapping to intervene)", () => {
    const dispatch = vi.fn();
    // Explicit <void, { phase: ScanPhase }> generics — without them, TS infers
    // Props from the STEP2_REVIEWING-shaped initialProps literal alone (not the
    // ScanPhase-annotated variable's declared type), so the later rerender()
    // with a differently-shaped phase falsely fails structural typing.
    const { rerender } = renderHook<void, { phase: ScanPhase }>(
      ({ phase }) => useAutoAdvanceTimer(phase, false, dispatch),
      { initialProps: { phase: step2Reviewing } },
    );

    vi.advanceTimersByTime(500);
    rerender({ phase: barcodeLocked });
    vi.advanceTimersByTime(1000);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not double-fire when re-rendered with the same phase (rapid re-capture guard)", () => {
    const dispatch = vi.fn();
    const { rerender } = renderHook<void, { phase: ScanPhase }>(
      ({ phase }) => useAutoAdvanceTimer(phase, false, dispatch),
      { initialProps: { phase: step2Reviewing } },
    );

    vi.advanceTimersByTime(500);
    rerender({ phase: step2Reviewing });
    vi.advanceTimersByTime(500);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
