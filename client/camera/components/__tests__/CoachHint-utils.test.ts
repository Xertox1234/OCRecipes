import { describe, it, expect } from "vitest";
import { getCoachMessage } from "../CoachHint-utils";
import type { ScanPhase } from "../../types/scan-phase";

const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };

describe("getCoachMessage", () => {
  it('returns "Point at a barcode" for HUNTING at 0s', () => {
    expect(getCoachMessage({ type: "HUNTING" }, 0)).toBe("Point at a barcode");
  });

  it('escalates to "Try moving closer" at 5s', () => {
    expect(getCoachMessage({ type: "HUNTING" }, 5)).toBe("Try moving closer");
  });

  it("escalates to torch tip at 10s", () => {
    expect(getCoachMessage({ type: "HUNTING" }, 10)).toBe(
      "Or tap ⚡ for torch",
    );
  });

  it("escalates to manual capture tip at 15s", () => {
    expect(getCoachMessage({ type: "HUNTING" }, 15)).toBe(
      "Or tap to capture manually",
    );
  });

  it('returns "Hold steady…" for BARCODE_TRACKING', () => {
    expect(
      getCoachMessage(
        {
          type: "BARCODE_TRACKING",
          barcode: "123",
          bounds: BOUNDS,
          frameCount: 3,
        },
        0,
      ),
    ).toBe("Hold steady…");
  });

  it("returns empty string for BARCODE_LOCKED", () => {
    expect(
      getCoachMessage(
        { type: "BARCODE_LOCKED", barcode: "123", bounds: BOUNDS },
        0,
      ),
    ).toBe("");
  });

  it('returns "Frame the Nutrition Facts panel" for STEP2_CAPTURING', () => {
    expect(
      getCoachMessage({ type: "STEP2_CAPTURING", barcode: "123" }, 0),
    ).toBe("Frame the Nutrition Facts panel");
  });

  it("returns empty string for STEP2_REVIEWING", () => {
    expect(
      getCoachMessage(
        { type: "STEP2_REVIEWING", barcode: "123", imageUri: "x", ocrText: "" },
        0,
      ),
    ).toBe("");
  });

  it('returns "Frame the front of the package" for STEP3_CAPTURING', () => {
    expect(
      getCoachMessage(
        {
          type: "STEP3_CAPTURING",
          barcode: "123",
          nutritionImageUri: "x",
          ocrText: "",
        },
        0,
      ),
    ).toBe("Frame the front of the package");
  });

  it("returns empty string for CLASSIFYING", () => {
    expect(getCoachMessage({ type: "CLASSIFYING", imageUri: "x" }, 0)).toBe("");
  });

  it('returns "Point at a barcode" for IDLE at 0s', () => {
    expect(getCoachMessage({ type: "IDLE" }, 0)).toBe("Point at a barcode");
  });

  it("returns empty string for STEP2_CONFIRMED", () => {
    expect(
      getCoachMessage(
        {
          type: "STEP2_CONFIRMED",
          barcode: "123",
          nutritionImageUri: "x",
          ocrText: "",
        },
        0,
      ),
    ).toBe("");
  });

  it("returns empty string for SESSION_COMPLETE", () => {
    expect(
      getCoachMessage({ type: "SESSION_COMPLETE", barcode: "123" }, 0),
    ).toBe("");
  });

  it("returns empty string for SMART_CONFIRMED", () => {
    const classification = {
      sessionId: null,
      intent: "auto",
      foods: [],
      overallConfidence: 0.9,
      needsFollowUp: false,
      followUpQuestions: [],
      contentType: "prepared_meal",
    } as any;
    expect(
      getCoachMessage(
        { type: "SMART_CONFIRMED", imageUri: "x", classification },
        0,
      ),
    ).toBe("");
  });

  it("returns empty string for SMART_ERROR", () => {
    expect(
      getCoachMessage(
        { type: "SMART_ERROR", imageUri: "x", error: "timeout" },
        0,
      ),
    ).toBe("");
  });

  it("elapsedSeconds between escalation thresholds uses previous message", () => {
    expect(getCoachMessage({ type: "HUNTING" }, 7)).toBe("Try moving closer");
    expect(getCoachMessage({ type: "HUNTING" }, 12)).toBe(
      "Or tap ⚡ for torch",
    );
  });

  it("returns empty string for STEP3_REVIEWING", () => {
    expect(
      getCoachMessage(
        {
          type: "STEP3_REVIEWING",
          barcode: "123",
          nutritionImageUri: "x",
          ocrText: "",
          frontImageUri: "y",
        },
        0,
      ),
    ).toBe("");
  });
});
