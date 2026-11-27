import { describe, it, expect } from "vitest";
import { getCoachMessage, getFlowCoachMessage } from "../CoachHint-utils";

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

  it('returns "Frame the Nutrition Facts panel" for BARCODE_LOCKED', () => {
    expect(
      getCoachMessage(
        { type: "BARCODE_LOCKED", barcode: "123", bounds: BOUNDS },
        0,
      ),
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

  it('returns "Frame the front of the package" for STEP2_CONFIRMED', () => {
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
    ).toBe("Frame the front of the package");
  });

  it("returns empty string for CLASSIFYING", () => {
    expect(getCoachMessage({ type: "CLASSIFYING", imageUri: "x" }, 0)).toBe("");
  });

  it('returns "Point at a barcode" for IDLE at 0s', () => {
    expect(getCoachMessage({ type: "IDLE" }, 0)).toBe("Point at a barcode");
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

  it('returns "Product confirmed. Now frame the Nutrition Facts panel" for LABEL_PROMPTED', () => {
    expect(getCoachMessage({ type: "LABEL_PROMPTED", barcode: "123" }, 0)).toBe(
      "Product confirmed. Now frame the Nutrition Facts panel",
    );
  });

  // ACCESSIBILITY-LOAD-BEARING, and the reason is not obvious.
  //
  // CoachHint announces via `useEffect(…, [message])` on iOS and relies on
  // `accessibilityLiveRegion="polite"` on Android. NEITHER re-fires when the
  // string is unchanged. If LABEL_PROMPTED reused BARCODE_LOCKED's exact copy,
  // a screen-reader user who presses "Next: nutrition →" would get the
  // chip silently unmounting and NO announcement at all — no confirmation their
  // tap did anything.
  //
  // So these two strings MUST differ. Do not "simplify" this by folding
  // LABEL_PROMPTED into the BARCODE_LOCKED case arm.
  it("uses copy distinct from BARCODE_LOCKED so the transition re-announces", () => {
    const locked = getCoachMessage(
      { type: "BARCODE_LOCKED", barcode: "123", bounds: BOUNDS },
      0,
    );
    const prompted = getCoachMessage(
      { type: "LABEL_PROMPTED", barcode: "123" },
      0,
    );
    expect(prompted).not.toBe(locked);
    expect(prompted).toBeTruthy();
  });
});

describe("getFlowCoachMessage", () => {
  const HINT = "Line the barcode up inside the frame";

  it("shows the step hint first, then escalates at 5 s / 10 s / 15 s", () => {
    const hunting = { type: "HUNTING" } as const;
    expect(getFlowCoachMessage(hunting, HINT, 0, "barcode")).toBe(HINT);
    expect(getFlowCoachMessage(hunting, HINT, 5, "barcode")).toBe(
      "Try moving closer",
    );
    expect(getFlowCoachMessage(hunting, HINT, 10, "barcode")).toBe(
      "Or tap ⚡ for torch",
    );
    expect(getFlowCoachMessage(hunting, HINT, 15, "barcode")).toBe(
      "Type the number",
    );
  });

  it("says hold steady while tracking", () => {
    expect(
      getFlowCoachMessage(
        {
          type: "BARCODE_TRACKING",
          barcode: "1",
          bounds: BOUNDS,
          frameCount: 2,
        },
        HINT,
        12,
        "barcode",
      ),
    ).toBe("Hold steady…");
  });

  it("is quiet while a card is up, and shows the step hint on photo steps", () => {
    expect(
      getFlowCoachMessage(
        { type: "BARCODE_LOCKED", barcode: "1", bounds: BOUNDS },
        HINT,
        0,
        "barcode",
      ),
    ).toBe("");
    expect(
      getFlowCoachMessage(
        { type: "LABEL_PROMPTED", barcode: "1" },
        "Fit the whole panel in the frame",
        0,
        "barcode",
      ),
    ).toBe("Fit the whole panel in the frame");
  });

  it("does not escalate an empty hint (the generic flow)", () => {
    expect(getFlowCoachMessage({ type: "HUNTING" }, "", 12, "generic")).toBe(
      "",
    );
  });

  // Barcode advice ("move closer", "type the number") is for the barcode
  // step only: the generic label flow lines up a photo and has no keypad.
  it("never escalates in the generic flow", () => {
    const LABEL = "Fit the whole panel in the frame";
    for (const seconds of [5, 10, 15, 30]) {
      expect(
        getFlowCoachMessage({ type: "HUNTING" }, LABEL, seconds, "generic"),
      ).toBe(LABEL);
    }
  });
});
