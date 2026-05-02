import { describe, it, expect } from "vitest";
import { scanPhaseReducer } from "../scan-phase-reducer";
import type { ScanPhase } from "../../types/scan-phase";
import type { PhotoAnalysisResponse } from "@/lib/photo-upload";

const BOUNDS = { x: 0.4, y: 0.45, width: 0.2, height: 0.1 };

describe("scanPhaseReducer", () => {
  it("CAMERA_READY transitions IDLE → HUNTING", () => {
    const state: ScanPhase = { type: "IDLE" };
    expect(scanPhaseReducer(state, { type: "CAMERA_READY" })).toEqual({
      type: "HUNTING",
    });
  });

  it("FIRST_BARCODE_DETECTED transitions HUNTING → BARCODE_TRACKING", () => {
    const state: ScanPhase = { type: "HUNTING" };
    const result = scanPhaseReducer(state, {
      type: "FIRST_BARCODE_DETECTED",
      barcode: "123",
      bounds: BOUNDS,
    });
    expect(result).toEqual({
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 1,
    });
  });

  it("BARCODE_UPDATED increments frameCount", () => {
    const state: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 3,
    };
    const newBounds = { x: 0.41, y: 0.45, width: 0.2, height: 0.1 };
    const result = scanPhaseReducer(state, {
      type: "BARCODE_UPDATED",
      bounds: newBounds,
    });
    expect(result).toEqual({
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: newBounds,
      frameCount: 4,
    });
  });

  it("BARCODE_LOCKED transitions BARCODE_TRACKING → BARCODE_LOCKED", () => {
    const state: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 7,
    };
    const result = scanPhaseReducer(state, { type: "BARCODE_LOCKED" });
    expect(result).toEqual({
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    });
  });

  it("PRODUCT_LOADED attaches product to BARCODE_LOCKED", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    };
    const product = { name: "Test Bar", brand: "Acme" };
    const result = scanPhaseReducer(state, { type: "PRODUCT_LOADED", product });
    expect(result).toEqual({
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
      product,
    });
  });

  it("BARCODE_LOST transitions BARCODE_TRACKING → HUNTING", () => {
    const state: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 2,
    };
    expect(scanPhaseReducer(state, { type: "BARCODE_LOST" })).toEqual({
      type: "HUNTING",
    });
  });

  it("CONFIRM_PRODUCT from BARCODE_LOCKED → SESSION_COMPLETE (barcode only)", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    };
    expect(scanPhaseReducer(state, { type: "CONFIRM_PRODUCT" })).toEqual({
      type: "SESSION_COMPLETE",
      barcode: "123",
    });
  });

  it("ADD_NUTRITION_PHOTO transitions BARCODE_LOCKED → STEP2_CAPTURING", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
      product: { name: "Bar" },
    };
    const result = scanPhaseReducer(state, { type: "ADD_NUTRITION_PHOTO" });
    expect(result).toEqual({
      type: "STEP2_CAPTURING",
      barcode: "123",
      product: { name: "Bar" },
    });
  });

  it("STEP_PHOTO_CAPTURED from STEP2_CAPTURING → STEP2_REVIEWING", () => {
    const state: ScanPhase = { type: "STEP2_CAPTURING", barcode: "123" };
    const result = scanPhaseReducer(state, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
    expect(result).toEqual({
      type: "STEP2_REVIEWING",
      barcode: "123",
      imageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
  });

  it("STEP_CONFIRMED from STEP2_REVIEWING → STEP2_CONFIRMED", () => {
    const state: ScanPhase = {
      type: "STEP2_REVIEWING",
      barcode: "123",
      imageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    };
    const result = scanPhaseReducer(state, { type: "STEP_CONFIRMED" });
    expect(result).toEqual({
      type: "STEP2_CONFIRMED",
      barcode: "123",
      nutritionImageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
  });

  it("CONFIRM_PRODUCT from STEP2_CONFIRMED → SESSION_COMPLETE with nutrition data", () => {
    const state: ScanPhase = {
      type: "STEP2_CONFIRMED",
      barcode: "123",
      nutritionImageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    };
    const result = scanPhaseReducer(state, { type: "CONFIRM_PRODUCT" });
    expect(result).toEqual({
      type: "SESSION_COMPLETE",
      barcode: "123",
      nutritionImageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
  });

  it("ADD_FRONT_PHOTO transitions STEP2_CONFIRMED → STEP3_CAPTURING", () => {
    const state: ScanPhase = {
      type: "STEP2_CONFIRMED",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
    };
    const result = scanPhaseReducer(state, { type: "ADD_FRONT_PHOTO" });
    expect(result).toEqual({
      type: "STEP3_CAPTURING",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
    });
  });

  it("STEP_PHOTO_CAPTURED from STEP3_CAPTURING → STEP3_REVIEWING", () => {
    const state: ScanPhase = {
      type: "STEP3_CAPTURING",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
    };
    const result = scanPhaseReducer(state, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file://front.jpg",
    });
    expect(result).toEqual({
      type: "STEP3_REVIEWING",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
      frontImageUri: "file://front.jpg",
    });
  });

  it("CONFIRM_PRODUCT from STEP3_REVIEWING → SESSION_COMPLETE with all data", () => {
    const state: ScanPhase = {
      type: "STEP3_REVIEWING",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
      frontImageUri: "file://front.jpg",
    };
    const result = scanPhaseReducer(state, { type: "CONFIRM_PRODUCT" });
    expect(result).toEqual({
      type: "SESSION_COMPLETE",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
      frontImageUri: "file://front.jpg",
    });
  });

  it("SMART_PHOTO_INITIATED → CLASSIFYING", () => {
    const state: ScanPhase = { type: "HUNTING" };
    expect(
      scanPhaseReducer(state, {
        type: "SMART_PHOTO_INITIATED",
        imageUri: "file://meal.jpg",
      }),
    ).toEqual({ type: "CLASSIFYING", imageUri: "file://meal.jpg" });
  });

  it("CLASSIFICATION_SUCCEEDED from CLASSIFYING → SMART_CONFIRMED", () => {
    const classification: PhotoAnalysisResponse = {
      sessionId: null,
      intent: "auto",
      foods: [],
      overallConfidence: 0.9,
      needsFollowUp: false,
      followUpQuestions: [],
      contentType: "prepared_meal",
    };
    const state: ScanPhase = {
      type: "CLASSIFYING",
      imageUri: "file://meal.jpg",
    };
    const result = scanPhaseReducer(state, {
      type: "CLASSIFICATION_SUCCEEDED",
      classification,
    });
    expect(result).toEqual({
      type: "SMART_CONFIRMED",
      imageUri: "file://meal.jpg",
      classification,
    });
  });

  it("CLASSIFICATION_FAILED from CLASSIFYING → SMART_ERROR", () => {
    const state: ScanPhase = {
      type: "CLASSIFYING",
      imageUri: "file://meal.jpg",
    };
    const result = scanPhaseReducer(state, {
      type: "CLASSIFICATION_FAILED",
      error: "timeout",
    });
    expect(result).toEqual({
      type: "SMART_ERROR",
      imageUri: "file://meal.jpg",
      error: "timeout",
    });
  });

  it("RESET always returns IDLE", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    };
    expect(scanPhaseReducer(state, { type: "RESET" })).toEqual({
      type: "IDLE",
    });
  });

  it("ignores actions that do not apply to the current phase", () => {
    const state: ScanPhase = { type: "HUNTING" };
    expect(
      scanPhaseReducer(state, { type: "BARCODE_UPDATED", bounds: BOUNDS }),
    ).toEqual(state);
    expect(scanPhaseReducer(state, { type: "BARCODE_LOCKED" })).toEqual(state);
    expect(scanPhaseReducer(state, { type: "ADD_NUTRITION_PHOTO" })).toEqual(
      state,
    );
  });

  it("STEP_CONFIRMED is a no-op from STEP3_REVIEWING (use CONFIRM_PRODUCT instead)", () => {
    // STEP3_REVIEWING advances via CONFIRM_PRODUCT, not STEP_CONFIRMED
    const state: ScanPhase = {
      type: "STEP3_REVIEWING",
      barcode: "123",
      nutritionImageUri: "file://nutrition.jpg",
      ocrText: "Calories 200",
      frontImageUri: "file://front.jpg",
    };
    expect(scanPhaseReducer(state, { type: "STEP_CONFIRMED" })).toEqual(state);
  });

  it("BARCODE_LOST from non-tracking state is a no-op", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: { x: 0.4, y: 0.45, width: 0.2, height: 0.1 },
    };
    expect(scanPhaseReducer(state, { type: "BARCODE_LOST" })).toEqual(state);
  });

  it("FIRST_BARCODE_DETECTED mid-tracking resets frameCount to 1 with new barcode", () => {
    const state: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "111",
      bounds: BOUNDS,
      frameCount: 4,
    };
    const newBounds = { x: 0.3, y: 0.4, width: 0.2, height: 0.1 };
    const result = scanPhaseReducer(state, {
      type: "FIRST_BARCODE_DETECTED",
      barcode: "999",
      bounds: newBounds,
    });
    expect(result).toEqual({
      type: "BARCODE_TRACKING",
      barcode: "999",
      bounds: newBounds,
      frameCount: 1,
    });
  });
});
