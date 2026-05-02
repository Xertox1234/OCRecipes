import { describe, it, expect } from "vitest";
import { getStepDotState, shouldShowStepPill } from "../StepPill-utils";

const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };

describe("getStepDotState", () => {
  it("all dots idle in HUNTING", () => {
    const phase = { type: "HUNTING" } as const;
    expect(getStepDotState(phase, 0)).toBe("active"); // step 1 is active when hunting
    expect(getStepDotState(phase, 1)).toBe("idle");
    expect(getStepDotState(phase, 2)).toBe("idle");
  });

  it("step 1 active during BARCODE_TRACKING", () => {
    const phase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 3,
    } as const;
    expect(getStepDotState(phase, 0)).toBe("active");
    expect(getStepDotState(phase, 1)).toBe("idle");
  });

  it("step 1 done, step 2 active in STEP2_CAPTURING", () => {
    const phase = { type: "STEP2_CAPTURING", barcode: "123" } as const;
    expect(getStepDotState(phase, 0)).toBe("done");
    expect(getStepDotState(phase, 1)).toBe("active");
    expect(getStepDotState(phase, 2)).toBe("idle");
  });

  it("steps 1+2 done, step 3 active in STEP3_CAPTURING", () => {
    const phase = {
      type: "STEP3_CAPTURING",
      barcode: "123",
      nutritionImageUri: "x",
      ocrText: "",
    } as const;
    expect(getStepDotState(phase, 0)).toBe("done");
    expect(getStepDotState(phase, 1)).toBe("done");
    expect(getStepDotState(phase, 2)).toBe("active");
  });

  it("all done in SESSION_COMPLETE", () => {
    const phase = { type: "SESSION_COMPLETE", barcode: "123" } as const;
    expect(getStepDotState(phase, 0)).toBe("done");
    expect(getStepDotState(phase, 1)).toBe("done");
    expect(getStepDotState(phase, 2)).toBe("done");
  });
});

describe("shouldShowStepPill", () => {
  it("shows for packaged product states", () => {
    expect(shouldShowStepPill({ type: "HUNTING" })).toBe(true);
    expect(
      shouldShowStepPill({
        type: "BARCODE_TRACKING",
        barcode: "123",
        bounds: BOUNDS,
        frameCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldShowStepPill({
        type: "BARCODE_LOCKED",
        barcode: "123",
        bounds: BOUNDS,
      }),
    ).toBe(true);
    expect(
      shouldShowStepPill({ type: "STEP2_CAPTURING", barcode: "123" }),
    ).toBe(true);
  });

  it("hides for smart photo states", () => {
    expect(shouldShowStepPill({ type: "CLASSIFYING", imageUri: "x" })).toBe(
      false,
    );
    expect(
      shouldShowStepPill({
        type: "SMART_CONFIRMED",
        imageUri: "x",
        classification: {} as any,
      }),
    ).toBe(false);
    expect(
      shouldShowStepPill({ type: "SMART_ERROR", imageUri: "x", error: "err" }),
    ).toBe(false);
  });

  it("hides for IDLE", () => {
    expect(shouldShowStepPill({ type: "IDLE" })).toBe(false);
  });
});
