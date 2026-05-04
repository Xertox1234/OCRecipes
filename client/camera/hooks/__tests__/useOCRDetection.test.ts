import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Haptics from "expo-haptics";
import {
  processOCRFrame,
  onOCRDebounceExpired,
  onOCRDisabled,
  INITIAL_OCR_STATE,
  type OCRDetectionState,
  type OCREffect,
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

// ---------------------------------------------------------------------------
// Integration harness — mirrors the handleOCRResult + applyEffects logic
// from useOCRDetection.ts without requiring React hooks or native modules.
// Pattern: replicate the side-effect dispatcher inline (same as useCamera.test.ts).
// ---------------------------------------------------------------------------

function createOCRHandlerHarness(options?: { debounceMs?: number }) {
  const debounceMs = options?.debounceMs ?? 500;
  const onTextDetected = vi.fn();
  const latestOCRResult: { current: object | null } = { current: null };
  const detectionState: { current: OCRDetectionState } = {
    current: INITIAL_OCR_STATE,
  };
  const debounceTimer: { current: ReturnType<typeof setTimeout> | null } = {
    current: null,
  };

  function applyEffects(effects: OCREffect[]) {
    for (const effect of effects) {
      switch (effect.type) {
        case "notify_detected":
          onTextDetected(effect.value);
          break;
        case "fire_haptic":
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        case "start_debounce":
          debounceTimer.current = setTimeout(() => {
            debounceTimer.current = null;
            const { state: next, effects: expiredEffects } =
              onOCRDebounceExpired(detectionState.current);
            detectionState.current = next;
            applyEffects(expiredEffects);
          }, debounceMs);
          break;
        case "cancel_debounce":
          if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
            debounceTimer.current = null;
          }
          break;
      }
    }
  }

  function handleOCRResult(resultText: string) {
    const hasText = resultText.trim().length > 0;
    const fakeResult = { resultText };
    latestOCRResult.current = hasText ? fakeResult : null;

    const { state: next, effects } = processOCRFrame(
      detectionState.current,
      hasText,
    );
    detectionState.current = next;
    applyEffects(effects);
  }

  function disable() {
    latestOCRResult.current = null;
    const { state: next, effects } = onOCRDisabled(detectionState.current);
    detectionState.current = next;
    applyEffects(effects);
  }

  return {
    handleOCRResult,
    disable,
    onTextDetected,
    latestOCRResult,
    detectionState,
    debounceTimer,
  };
}

describe("handleOCRResult integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("first text detection calls onTextDetected(true) and fires haptic exactly once", () => {
    const impactSpy = vi.spyOn(Haptics, "impactAsync");
    const { handleOCRResult, onTextDetected } = createOCRHandlerHarness();

    handleOCRResult("Hello World");

    expect(onTextDetected).toHaveBeenCalledTimes(1);
    expect(onTextDetected).toHaveBeenCalledWith(true);
    expect(impactSpy).toHaveBeenCalledTimes(1);
    expect(impactSpy).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  it("subsequent text frames do NOT re-fire onTextDetected(true) or haptic", () => {
    const impactSpy = vi.spyOn(Haptics, "impactAsync");
    const { handleOCRResult, onTextDetected } = createOCRHandlerHarness();

    handleOCRResult("Hello World"); // first detection
    handleOCRResult("Hello World"); // second frame — same text
    handleOCRResult("Different text"); // third frame — different text, still detected

    expect(onTextDetected).toHaveBeenCalledTimes(1); // only the first call
    expect(impactSpy).toHaveBeenCalledTimes(1); // haptic only once per session
  });

  it("text disappearing debounces onTextDetected(false) by debounceMs", () => {
    const { handleOCRResult, onTextDetected } = createOCRHandlerHarness({
      debounceMs: 500,
    });

    handleOCRResult("Hello World"); // detect text
    expect(onTextDetected).toHaveBeenCalledWith(true);
    vi.clearAllMocks();

    handleOCRResult(""); // text disappears — should start debounce

    // Not yet called — debounce hasn't fired
    expect(onTextDetected).not.toHaveBeenCalled();

    // Advance past the debounce window
    vi.advanceTimersByTime(500);

    expect(onTextDetected).toHaveBeenCalledTimes(1);
    expect(onTextDetected).toHaveBeenCalledWith(false);
  });

  it("text reappearing during the debounce window cancels the pending false callback", () => {
    const { handleOCRResult, onTextDetected } = createOCRHandlerHarness({
      debounceMs: 500,
    });

    handleOCRResult("Hello World"); // detect text
    handleOCRResult(""); // text disappears — debounce starts
    vi.clearAllMocks();

    // Text reappears before debounce fires
    vi.advanceTimersByTime(200);
    handleOCRResult("Hello World");

    // Advance past original debounce window — timer was cancelled, so no false notification
    vi.advanceTimersByTime(400);

    expect(onTextDetected).not.toHaveBeenCalled();
  });

  it("enabled=false resets haptic flag, isTextDetectedRef, and latestOCRResult", () => {
    const {
      handleOCRResult,
      disable,
      onTextDetected,
      detectionState,
      latestOCRResult,
    } = createOCRHandlerHarness();

    handleOCRResult("Hello World"); // detect text
    expect(detectionState.current.isTextDetected).toBe(true);
    expect(detectionState.current.hasHapticFired).toBe(true);
    expect(latestOCRResult.current).not.toBeNull();

    vi.clearAllMocks();
    disable(); // simulate enabled=false

    // latestOCRResult cleared
    expect(latestOCRResult.current).toBeNull();
    // state reset to initial
    expect(detectionState.current).toEqual(INITIAL_OCR_STATE);
    // UI notified of false (glow dismissed)
    expect(onTextDetected).toHaveBeenCalledWith(false);
  });

  it("enabled=false with pending debounce cancels timer and notifies false", () => {
    const { handleOCRResult, disable, onTextDetected, debounceTimer } =
      createOCRHandlerHarness({ debounceMs: 500 });

    handleOCRResult("Hello World"); // detect text
    handleOCRResult(""); // text disappears — debounce pending
    expect(debounceTimer.current).not.toBeNull();

    vi.clearAllMocks();
    disable(); // disable while debounce is pending

    expect(debounceTimer.current).toBeNull(); // timer cancelled
    expect(onTextDetected).toHaveBeenCalledWith(false); // UI notified immediately
  });
});
