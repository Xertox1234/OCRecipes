import { useRef, useCallback, useEffect, useMemo } from "react";
import { useTextRecognition } from "react-native-vision-camera-ocr-plus";
import type { Text as OCRText } from "react-native-vision-camera-ocr-plus";
import { useFrameOutput } from "react-native-vision-camera";
import type { Frame } from "react-native-vision-camera";
import { runOnJS } from "react-native-worklets";
import * as Haptics from "expo-haptics";
import {
  processOCRFrame,
  onOCRDebounceExpired,
  onOCRDisabled,
  INITIAL_OCR_STATE,
  type OCRDetectionState,
} from "./useOCRDetection-utils";

export interface UseOCRDetectionOptions {
  /** Whether OCR detection is active */
  enabled: boolean;
  /** Called when text detection state changes */
  onTextDetected?: (detected: boolean) => void;
  /** Called with raw OCR result after each processed frame */
  onOCRResult?: (text: OCRText) => void;
  /** Debounce ms before firing textDetected(false). Default: 500 */
  debounceMs?: number;
}

export interface UseOCRDetectionReturn {
  /** Frame output to include in Camera outputs array (undefined when disabled) */
  frameOutput: ReturnType<typeof useFrameOutput> | undefined;
  /** Most recent OCR result — read on capture to pass to LabelAnalysisScreen */
  latestOCRResult: React.RefObject<OCRText | null>;
}

/**
 * Wraps react-native-vision-camera-ocr-plus in a V5-compatible frame output.
 * Debounces text detection state, fires haptic once per session, and caches
 * the latest OCR result for post-capture access.
 *
 * Only active when `enabled` is true (label mode only).
 */
export function useOCRDetection(
  options: UseOCRDetectionOptions,
): UseOCRDetectionReturn {
  const { enabled, onTextDetected, onOCRResult, debounceMs = 500 } = options;

  const latestOCRResult = useRef<OCRText | null>(null);
  const detectionStateRef = useRef<OCRDetectionState>(INITIAL_OCR_STATE);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable refs so worklet closures stay fresh without re-creating frame output
  const onTextDetectedRef = useRef(onTextDetected);
  const onOCRResultRef = useRef(onOCRResult);
  useEffect(() => {
    onTextDetectedRef.current = onTextDetected;
  }, [onTextDetected]);
  useEffect(() => {
    onOCRResultRef.current = onOCRResult;
  }, [onOCRResult]);

  // Apply effects produced by the pure state machine
  const applyEffects = useCallback(
    (effects: ReturnType<typeof processOCRFrame>["effects"]) => {
      for (const effect of effects) {
        switch (effect.type) {
          case "notify_detected":
            onTextDetectedRef.current?.(effect.value);
            break;
          case "fire_haptic":
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            break;
          case "start_debounce":
            debounceTimerRef.current = setTimeout(() => {
              debounceTimerRef.current = null;
              const { state: next, effects: expiredEffects } =
                onOCRDebounceExpired(detectionStateRef.current);
              detectionStateRef.current = next;
              applyEffects(expiredEffects);
            }, debounceMs);
            break;
          case "cancel_debounce":
            if (debounceTimerRef.current) {
              clearTimeout(debounceTimerRef.current);
              debounceTimerRef.current = null;
            }
            break;
        }
      }
    },
    [debounceMs],
  );

  // Reset session state when disabled (Bug #2: notify UI if glow was active)
  useEffect(() => {
    if (!enabled) {
      latestOCRResult.current = null;
      const { state: next, effects } = onOCRDisabled(detectionStateRef.current);
      detectionStateRef.current = next;
      applyEffects(effects); // cancel_debounce and notify_detected(false) are included as needed
    }
  }, [enabled, applyEffects]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const { scanText } = useTextRecognition({
    language: "latin",
  });

  // JS-thread handler — called from worklet via runOnJS bridge.
  // Stable via useCallback so the memoized runOnJS wrapper below stays stable.
  const handleOCRResult = useCallback(
    (result: OCRText) => {
      const hasText = (result.resultText?.trim().length ?? 0) > 0;
      latestOCRResult.current = hasText ? result : null;

      if (hasText) {
        onOCRResultRef.current?.(result);
      }

      const { state: next, effects } = processOCRFrame(
        detectionStateRef.current,
        hasText,
      );
      detectionStateRef.current = next;
      applyEffects(effects);
    },
    [applyEffects],
  );

  // Memoized JS bridge — recreated only when the JS handler changes.
  // runOnJS returns a wrapped function that can be called from worklets.
  const handleOCRResultJS = useMemo(
    () => runOnJS(handleOCRResult),
    [handleOCRResult],
  );

  // Frame counter for manual skip — stored as a plain object to allow
  // mutation from within the worklet. The 'current' pattern on a ref is
  // a JS object property, safe to read/write from a VisionCamera worklet
  // running on the same JS thread boundary that the frame output uses.
  const frameCountRef = useRef({ value: 0 });

  const frameOutput = useFrameOutput({
    onFrame: useCallback(
      (frame: Frame) => {
        "worklet";
        try {
          // Manual frame skip — process every 10th frame (~3fps OCR at 30fps)
          frameCountRef.current.value = (frameCountRef.current.value + 1) % 10;
          if (frameCountRef.current.value !== 0) {
            frame.dispose();
            return;
          }
          // scanText is a VisionCamera plugin worklet; cast frame to satisfy
          // the OCR library's V4-typed parameter (same underlying object at runtime)
          const result = scanText(frame as Parameters<typeof scanText>[0]);
          frame.dispose();
          handleOCRResultJS(result);
        } catch {
          try {
            frame.dispose();
          } catch {
            // ignore double-dispose
          }
        }
      },
      [scanText, handleOCRResultJS],
    ),
  });

  return {
    frameOutput: enabled ? frameOutput : undefined,
    latestOCRResult,
  };
}
