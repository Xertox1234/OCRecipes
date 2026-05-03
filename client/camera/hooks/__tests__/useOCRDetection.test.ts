import { describe, it, expect } from "vitest";
import {
  processOCRFrame,
  onOCRDebounceExpired,
  onOCRDisabled,
  INITIAL_OCR_STATE,
  type OCRDetectionState,
} from "../useOCRDetection-utils";

const detected: OCRDetectionState = {
  isTextDetected: true,
  hasHapticFired: true,
  debounceActive: false,
};

const detectedWithDebounce: OCRDetectionState = {
  isTextDetected: true,
  hasHapticFired: true,
  debounceActive: true,
};

describe("processOCRFrame", () => {
  it("notifies and fires haptic when text first enters frame", () => {
    const { state, effects } = processOCRFrame(INITIAL_OCR_STATE, true);
    expect(state.isTextDetected).toBe(true);
    expect(state.hasHapticFired).toBe(true);
    expect(state.debounceActive).toBe(false);
    expect(effects).toContainEqual({ type: "notify_detected", value: true });
    expect(effects).toContainEqual({ type: "fire_haptic" });
  });

  it("does not fire haptic again when text stays in frame after first detection", () => {
    const alreadyFired: OCRDetectionState = {
      isTextDetected: false,
      hasHapticFired: true,
      debounceActive: false,
    };
    const { effects } = processOCRFrame(alreadyFired, true);
    expect(effects).toContainEqual({ type: "notify_detected", value: true });
    expect(effects).not.toContainEqual({ type: "fire_haptic" });
  });

  it("emits nothing when text stays detected with no pending debounce", () => {
    const { state, effects } = processOCRFrame(detected, true);
    expect(state).toEqual(detected);
    expect(effects).toHaveLength(0);
  });

  // Bug #1: debounce timer must be cancelled when text re-enters frame
  it("cancels pending debounce when text re-enters frame before timer fires", () => {
    const { state, effects } = processOCRFrame(detectedWithDebounce, true);
    expect(state.debounceActive).toBe(false);
    expect(effects).toContainEqual({ type: "cancel_debounce" });
    expect(effects).not.toContainEqual({
      type: "notify_detected",
      value: false,
    });
  });

  it("does not re-notify when text re-enters frame and debounce is cancelled", () => {
    const { effects } = processOCRFrame(detectedWithDebounce, true);
    expect(effects).not.toContainEqual({
      type: "notify_detected",
      value: true,
    });
  });

  it("starts debounce when text leaves frame for the first time", () => {
    const { state, effects } = processOCRFrame(detected, false);
    expect(state.debounceActive).toBe(true);
    expect(state.isTextDetected).toBe(true);
    expect(effects).toContainEqual({ type: "start_debounce" });
  });

  it("does not start a second debounce when text is still absent", () => {
    const { state, effects } = processOCRFrame(detectedWithDebounce, false);
    expect(state).toEqual(detectedWithDebounce);
    expect(effects).toHaveLength(0);
  });

  it("emits nothing when no text and already not detected", () => {
    const { state, effects } = processOCRFrame(INITIAL_OCR_STATE, false);
    expect(state).toEqual(INITIAL_OCR_STATE);
    expect(effects).toHaveLength(0);
  });
});

describe("onOCRDebounceExpired", () => {
  it("transitions to not-detected and notifies when debounce fires", () => {
    const { state, effects } = onOCRDebounceExpired(detectedWithDebounce);
    expect(state.isTextDetected).toBe(false);
    expect(state.debounceActive).toBe(false);
    expect(state.hasHapticFired).toBe(true);
    expect(effects).toContainEqual({ type: "notify_detected", value: false });
  });
});

describe("onOCRDisabled", () => {
  it("resets to initial state and emits no notification when already not detected", () => {
    const { state, effects } = onOCRDisabled(INITIAL_OCR_STATE);
    expect(state).toEqual(INITIAL_OCR_STATE);
    expect(effects).toHaveLength(0);
  });

  // Bug #2: disabling OCR while glow is active must emit notify_detected(false)
  it("notifies false when disabled while text is detected", () => {
    const { state, effects } = onOCRDisabled(detected);
    expect(state).toEqual(INITIAL_OCR_STATE);
    expect(effects).toContainEqual({ type: "notify_detected", value: false });
  });

  it("cancels debounce and notifies false when disabled with pending debounce", () => {
    const { state, effects } = onOCRDisabled(detectedWithDebounce);
    expect(state).toEqual(INITIAL_OCR_STATE);
    expect(effects).toContainEqual({ type: "cancel_debounce" });
    expect(effects).toContainEqual({ type: "notify_detected", value: false });
  });
});
