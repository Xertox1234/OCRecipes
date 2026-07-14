import { describe, it, expect } from "vitest";
import {
  getStepDotState,
  shouldShowStepPill,
  getActiveStepIndex,
} from "../StepPill-utils";

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

  it("step 1 active in BARCODE_LOCKED (armed for nutrition capture)", () => {
    const phase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    } as const;
    expect(getStepDotState(phase, 0)).toBe("done");
    expect(getStepDotState(phase, 1)).toBe("active");
    expect(getStepDotState(phase, 2)).toBe("idle");
  });

  it("steps 1+2 done, step 3 active in STEP2_CONFIRMED (armed for front capture)", () => {
    const phase = {
      type: "STEP2_CONFIRMED",
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

  it("step 1 done, step 2 active in STEP2_REVIEWING", () => {
    const phase = {
      type: "STEP2_REVIEWING",
      barcode: "123",
      ocrText: "",
      imageUri: "x",
    } as const;
    expect(getStepDotState(phase, 0)).toBe("done");
    expect(getStepDotState(phase, 1)).toBe("active");
    expect(getStepDotState(phase, 2)).toBe("idle");
  });

  it("steps 1+2 done, step 3 active in STEP3_REVIEWING", () => {
    const phase = {
      type: "STEP3_REVIEWING",
      barcode: "123",
      nutritionImageUri: "x",
      ocrText: "",
      frontImageUri: "y",
    } as const;
    expect(getStepDotState(phase, 0)).toBe("done");
    expect(getStepDotState(phase, 1)).toBe("done");
    expect(getStepDotState(phase, 2)).toBe("active");
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
      shouldShowStepPill({
        type: "STEP2_REVIEWING",
        barcode: "123",
        ocrText: "",
        imageUri: "x",
      }),
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

describe("getActiveStepIndex", () => {
  it("returns 0 while hunting or tracking a barcode", () => {
    expect(getActiveStepIndex({ type: "HUNTING" })).toBe(0);
    expect(
      getActiveStepIndex({
        type: "BARCODE_TRACKING",
        barcode: "1",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        frameCount: 1,
      }),
    ).toBe(0);
  });

  it("returns 1 once the barcode is locked (armed for nutrition, no separate arm step)", () => {
    expect(
      getActiveStepIndex({
        type: "BARCODE_LOCKED",
        barcode: "1",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ).toBe(1);
  });

  it("returns 1 while reviewing the captured nutrition photo", () => {
    expect(
      getActiveStepIndex({
        type: "STEP2_REVIEWING",
        barcode: "1",
        imageUri: "x",
        ocrText: "",
      }),
    ).toBe(1);
  });

  it("returns 2 once nutrition is confirmed (armed for front, reviewing front, or complete)", () => {
    expect(
      getActiveStepIndex({
        type: "STEP2_CONFIRMED",
        barcode: "1",
        nutritionImageUri: "x",
        ocrText: "",
      }),
    ).toBe(2);
    expect(
      getActiveStepIndex({
        type: "STEP3_REVIEWING",
        barcode: "1",
        nutritionImageUri: "x",
        ocrText: "",
        frontImageUri: "y",
      }),
    ).toBe(2);
    expect(getActiveStepIndex({ type: "SESSION_COMPLETE", barcode: "1" })).toBe(
      2,
    );
  });

  it("returns null for phases that don't show the step pill", () => {
    expect(getActiveStepIndex({ type: "IDLE" })).toBeNull();
    expect(
      getActiveStepIndex({ type: "CLASSIFYING", imageUri: "x" }),
    ).toBeNull();
  });
});
