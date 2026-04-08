import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test the OCR detection callback logic by simulating the hook's internal behavior
describe("useOCRDetection logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Simulate the handleOCRResult callback logic extracted from the hook
  function createOCRHandler(options: {
    onTextDetected?: (detected: boolean) => void;
    onOCRResult?: (text: { resultText: string }) => void;
    debounceMs?: number;
  }) {
    const { onTextDetected, onOCRResult, debounceMs = 500 } = options;
    const isTextDetectedRef = { current: false };
    const hasHapticsRef = { current: false };
    const latestOCRResult = { current: null as { resultText: string } | null };
    const debounceTimerRef = {
      current: null as ReturnType<typeof setTimeout> | null,
    };

    const handleOCRResult = (result: { resultText: string }) => {
      const hasText = result.resultText.trim().length > 0;
      latestOCRResult.current = hasText ? result : null;

      if (hasText) {
        onOCRResult?.(result);
      }

      if (hasText && !isTextDetectedRef.current) {
        isTextDetectedRef.current = true;
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        onTextDetected?.(true);
        if (!hasHapticsRef.current) {
          hasHapticsRef.current = true;
        }
      } else if (!hasText && isTextDetectedRef.current) {
        if (!debounceTimerRef.current) {
          debounceTimerRef.current = setTimeout(() => {
            isTextDetectedRef.current = false;
            debounceTimerRef.current = null;
            onTextDetected?.(false);
          }, debounceMs);
        }
      }
    };

    return {
      handleOCRResult,
      latestOCRResult,
      isTextDetectedRef,
      hasHapticsRef,
      debounceTimerRef,
    };
  }

  describe("text detection state transitions", () => {
    it("fires onTextDetected(true) on first text detection", () => {
      const onTextDetected = vi.fn();
      const { handleOCRResult } = createOCRHandler({ onTextDetected });

      handleOCRResult({ resultText: "Nutrition Facts" });
      expect(onTextDetected).toHaveBeenCalledWith(true);
    });

    it("does not fire onTextDetected(true) again while text is still detected", () => {
      const onTextDetected = vi.fn();
      const { handleOCRResult } = createOCRHandler({ onTextDetected });

      handleOCRResult({ resultText: "Nutrition Facts" });
      handleOCRResult({ resultText: "Calories 250" });
      expect(onTextDetected).toHaveBeenCalledTimes(1);
    });

    it("fires onTextDetected(false) after debounce when text disappears", () => {
      const onTextDetected = vi.fn();
      const { handleOCRResult } = createOCRHandler({
        onTextDetected,
        debounceMs: 500,
      });

      handleOCRResult({ resultText: "Nutrition Facts" });
      handleOCRResult({ resultText: "" });

      expect(onTextDetected).toHaveBeenCalledTimes(1); // only true so far
      vi.advanceTimersByTime(500);
      expect(onTextDetected).toHaveBeenCalledTimes(2);
      expect(onTextDetected).toHaveBeenLastCalledWith(false);
    });

    it("does not start a second debounce while one is pending", () => {
      const onTextDetected = vi.fn();
      const { handleOCRResult, debounceTimerRef } = createOCRHandler({
        onTextDetected,
        debounceMs: 500,
      });

      handleOCRResult({ resultText: "Nutrition Facts" }); // true
      handleOCRResult({ resultText: "" }); // start debounce
      const timer = debounceTimerRef.current;

      handleOCRResult({ resultText: "" }); // another empty frame
      expect(debounceTimerRef.current).toBe(timer); // same timer, no new one
    });
  });

  describe("haptic feedback", () => {
    it("sets hasHapticsRef only once per session", () => {
      const { handleOCRResult, hasHapticsRef } = createOCRHandler({});

      handleOCRResult({ resultText: "Nutrition Facts" });
      expect(hasHapticsRef.current).toBe(true);

      // Reset detection
      handleOCRResult({ resultText: "" });
      vi.advanceTimersByTime(600);

      // New text — haptic already fired
      handleOCRResult({ resultText: "Calories" });
      expect(hasHapticsRef.current).toBe(true); // still true, no second fire
    });
  });

  describe("latestOCRResult ref", () => {
    it("stores the latest OCR result when text is present", () => {
      const { handleOCRResult, latestOCRResult } = createOCRHandler({});
      const result = { resultText: "Nutrition Facts" };

      handleOCRResult(result);
      expect(latestOCRResult.current).toBe(result);
    });

    it("clears latestOCRResult when text disappears", () => {
      const { handleOCRResult, latestOCRResult } = createOCRHandler({});

      handleOCRResult({ resultText: "Nutrition Facts" });
      handleOCRResult({ resultText: "" });
      expect(latestOCRResult.current).toBeNull();
    });

    it("ignores whitespace-only text", () => {
      const { handleOCRResult, latestOCRResult } = createOCRHandler({});

      handleOCRResult({ resultText: "   \n  " });
      expect(latestOCRResult.current).toBeNull();
    });
  });

  describe("onOCRResult callback", () => {
    it("fires for every frame with text", () => {
      const onOCRResult = vi.fn();
      const { handleOCRResult } = createOCRHandler({ onOCRResult });

      handleOCRResult({ resultText: "Frame 1" });
      handleOCRResult({ resultText: "Frame 2" });
      handleOCRResult({ resultText: "Frame 3" });

      expect(onOCRResult).toHaveBeenCalledTimes(3);
    });

    it("does not fire for empty text", () => {
      const onOCRResult = vi.fn();
      const { handleOCRResult } = createOCRHandler({ onOCRResult });

      handleOCRResult({ resultText: "" });
      expect(onOCRResult).not.toHaveBeenCalled();
    });
  });
});
