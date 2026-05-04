// Pure state machine for OCR text detection — no refs, timers, or side-effects.
// The hook applies each OCREffect to its corresponding imperative handle.

export interface OCRDetectionState {
  isTextDetected: boolean;
  hasHapticFired: boolean;
  debounceActive: boolean;
}

export type OCREffect =
  | { type: "notify_detected"; value: boolean }
  | { type: "fire_haptic" }
  | { type: "start_debounce" }
  | { type: "cancel_debounce" };

export const INITIAL_OCR_STATE: OCRDetectionState = {
  isTextDetected: false,
  hasHapticFired: false,
  debounceActive: false,
};

export function processOCRFrame(
  state: OCRDetectionState,
  hasText: boolean,
): { state: OCRDetectionState; effects: OCREffect[] } {
  const effects: OCREffect[] = [];

  if (hasText) {
    // Always cancel any pending "no text" debounce when text is present
    if (state.debounceActive) {
      effects.push({ type: "cancel_debounce" });
    }

    if (!state.isTextDetected) {
      effects.push({ type: "notify_detected", value: true });
      if (!state.hasHapticFired) {
        effects.push({ type: "fire_haptic" });
      }
      return {
        state: {
          isTextDetected: true,
          hasHapticFired: true,
          debounceActive: false,
        },
        effects,
      };
    }

    // Already detected — cancel debounce only (if any), no further changes
    return { state: { ...state, debounceActive: false }, effects };
  }

  // hasText === false
  if (state.isTextDetected && !state.debounceActive) {
    effects.push({ type: "start_debounce" });
    return { state: { ...state, debounceActive: true }, effects };
  }

  return { state, effects };
}

export function onOCRDebounceExpired(state: OCRDetectionState): {
  state: OCRDetectionState;
  effects: OCREffect[];
} {
  return {
    state: { ...state, isTextDetected: false, debounceActive: false },
    effects: [{ type: "notify_detected", value: false }],
  };
}

export function onOCRDisabled(state: OCRDetectionState): {
  state: OCRDetectionState;
  effects: OCREffect[];
} {
  const effects: OCREffect[] = [];

  if (state.debounceActive) {
    effects.push({ type: "cancel_debounce" });
  }
  if (state.isTextDetected) {
    effects.push({ type: "notify_detected", value: false });
  }

  return { state: INITIAL_OCR_STATE, effects };
}
