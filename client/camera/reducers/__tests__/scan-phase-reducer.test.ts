import { describe, it, expect } from "vitest";
import { scanPhaseReducer } from "../scan-phase-reducer";
import {
  MANUAL_ENTRY_BOUNDS,
  type ResumablePhase,
  type ScanPhase,
} from "../../types/scan-phase";
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
    const result = scanPhaseReducer(state, {
      type: "PRODUCT_LOADED",
      barcode: "123",
      product,
    });
    expect(result).toEqual({
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
      product,
    });
  });

  // Camera audit 2026-11-21 M1: a slow lookup for barcode A must not attach
  // A's name and allergen flags to a later lock on barcode B.
  it("PRODUCT_LOADED for a different barcode leaves the locked state unchanged", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "222",
      bounds: BOUNDS,
    };
    const result = scanPhaseReducer(state, {
      type: "PRODUCT_LOADED",
      barcode: "111",
      product: { name: "Stale Bar", brand: "Acme" },
    });
    expect(result).toBe(state);
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

  it("STEP_PHOTO_CAPTURED from BARCODE_LOCKED → STEP2_REVIEWING (armed by lock, no separate arm action)", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
      product: { name: "Bar" },
    };
    const result = scanPhaseReducer(state, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
    expect(result).toEqual({
      type: "STEP2_REVIEWING",
      barcode: "123",
      product: { name: "Bar" },
      imageUri: "file://photo.jpg",
      ocrText: "Calories 200",
    });
  });

  // A step-2 capture ALWAYS means the user photographed a label. Collapsing an
  // unreadable read into "" made it indistinguishable from "no label captured",
  // so `useNutritionLookup`'s `ocrText ? …` guard skipped the label branch and
  // the wrong database value was presented as if it had been verified against
  // the package. `null` marks "captured but unreadable" so the failure is
  // representable — see todos/P2-2026-07-28-surface-unreadable-nutrition-label-ocr.md
  it.each([
    ["undefined (recognizer returned nothing)", undefined],
    ["empty string", ""],
    ["whitespace only", "   \n\t "],
  ])(
    "STEP_PHOTO_CAPTURED with %s marks the label unreadable, not absent",
    (_label, ocrText) => {
      const state: ScanPhase = {
        type: "BARCODE_LOCKED",
        barcode: "123",
        bounds: BOUNDS,
        product: { name: "Bar" },
      };

      const result = scanPhaseReducer(state, {
        type: "STEP_PHOTO_CAPTURED",
        imageUri: "file://photo.jpg",
        ocrText,
      });

      expect(result).toEqual({
        type: "STEP2_REVIEWING",
        barcode: "123",
        product: { name: "Bar" },
        imageUri: "file://photo.jpg",
        ocrText: null,
      });
    },
  );

  it("STEP_PHOTO_CAPTURED trims surrounding whitespace off a readable label", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "123",
      bounds: BOUNDS,
    };

    const result = scanPhaseReducer(state, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file://photo.jpg",
      ocrText: "  Calories 140  ",
    });

    expect(result).toMatchObject({ ocrText: "Calories 140" });
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

  it("STEP_PHOTO_CAPTURED from STEP2_CONFIRMED → STEP3_REVIEWING (armed by nutrition confirm, no separate arm action)", () => {
    const state: ScanPhase = {
      type: "STEP2_CONFIRMED",
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

  it("SMART_CONFIRM_FAILED from SMART_CONFIRMED → SMART_ERROR", () => {
    const classification: PhotoAnalysisResponse = {
      sessionId: null,
      intent: "auto",
      foods: [],
      overallConfidence: 0.9,
      needsFollowUp: false,
      followUpQuestions: [],
      contentType: "restaurant_menu",
    };
    const state: ScanPhase = {
      type: "SMART_CONFIRMED",
      imageUri: "file://menu.jpg",
      classification,
    };
    const result = scanPhaseReducer(state, { type: "SMART_CONFIRM_FAILED" });
    expect(result).toEqual({
      type: "SMART_ERROR",
      imageUri: "file://menu.jpg",
      error: "unrecognized",
    });
  });

  it("SMART_CONFIRM_FAILED is a no-op outside SMART_CONFIRMED", () => {
    const state: ScanPhase = { type: "IDLE" };
    expect(scanPhaseReducer(state, { type: "SMART_CONFIRM_FAILED" })).toEqual(
      state,
    );
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
    expect(
      scanPhaseReducer(state, {
        type: "STEP_PHOTO_CAPTURED",
        imageUri: "file://x.jpg",
      }),
    ).toEqual(state);
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

  // The primary CTA in BARCODE_LOCKED used to dispatch CONFIRM_PRODUCT, which
  // ends the session — so "Looks right →" was the SKIP button and steps 2/3
  // never ran. PROCEED_TO_LABEL is the advance that button needs.
  it("PROCEED_TO_LABEL transitions BARCODE_LOCKED → LABEL_PROMPTED, carrying the product", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "06772408",
      bounds: BOUNDS,
      product: { name: "Cherry Coke", brand: "Coca-Cola" },
    };

    expect(scanPhaseReducer(state, { type: "PROCEED_TO_LABEL" })).toEqual({
      type: "LABEL_PROMPTED",
      barcode: "06772408",
      product: { name: "Cherry Coke", brand: "Coca-Cola" },
    });
  });

  it("PROCEED_TO_LABEL is a no-op from any phase other than BARCODE_LOCKED", () => {
    const hunting: ScanPhase = { type: "HUNTING" };
    expect(scanPhaseReducer(hunting, { type: "PROCEED_TO_LABEL" })).toBe(
      hunting,
    );

    const step2: ScanPhase = {
      type: "STEP2_REVIEWING",
      barcode: "123",
      imageUri: "file://a.jpg",
      ocrText: "Calories 140",
    };
    expect(scanPhaseReducer(step2, { type: "PROCEED_TO_LABEL" })).toBe(step2);
  });

  it("STEP_PHOTO_CAPTURED from LABEL_PROMPTED → STEP2_REVIEWING with normalized ocrText", () => {
    const state: ScanPhase = {
      type: "LABEL_PROMPTED",
      barcode: "06772408",
      product: { name: "Cherry Coke" },
    };

    const result = scanPhaseReducer(state, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file://panel.jpg",
      ocrText: "  Calories 140  ",
    });

    expect(result).toEqual({
      type: "STEP2_REVIEWING",
      barcode: "06772408",
      product: { name: "Cherry Coke" },
      imageUri: "file://panel.jpg",
      ocrText: "Calories 140",
    });
  });

  it("an unreadable capture from LABEL_PROMPTED still yields ocrText null, not empty string", () => {
    const state: ScanPhase = {
      type: "LABEL_PROMPTED",
      barcode: "06772408",
    };

    const result = scanPhaseReducer(state, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file://blurry.jpg",
      ocrText: "   \n ",
    });

    expect(result).toMatchObject({ type: "STEP2_REVIEWING", ocrText: null });
  });

  // REGRESSION GUARD. The barcode-only escape hatch must survive this change —
  // a user may be offline, holding a damaged label, or navigating by screen
  // reader. CONFIRM_PRODUCT from BARCODE_LOCKED keeps its exact old behavior;
  // it just stops being wired to the PRIMARY button.
  it("CONFIRM_PRODUCT from BARCODE_LOCKED still ends the session (barcode-only path preserved)", () => {
    const state: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "06772408",
      bounds: BOUNDS,
      product: { name: "Cherry Coke" },
    };

    expect(scanPhaseReducer(state, { type: "CONFIRM_PRODUCT" })).toEqual({
      type: "SESSION_COMPLETE",
      barcode: "06772408",
    });
  });
});

// Owner decision 2026-11-22: Retake keeps the wizard's progress — it re-arms
// the camera for the same step, keeping the barcode and earlier photos.
describe("scanPhaseReducer — RETAKE_STEP", () => {
  const product = { name: "Oat milk" };

  it("STEP2_REVIEWING → LABEL_PROMPTED, keeping barcode and product", () => {
    const state: ScanPhase = {
      type: "STEP2_REVIEWING",
      barcode: "123",
      product,
      ocrText: "Calories 90",
      imageUri: "file:///n.jpg",
    };
    expect(scanPhaseReducer(state, { type: "RETAKE_STEP" })).toEqual({
      type: "LABEL_PROMPTED",
      barcode: "123",
      product,
    });
  });

  it("STEP3_REVIEWING → STEP2_CONFIRMED, keeping the nutrition photo", () => {
    const state: ScanPhase = {
      type: "STEP3_REVIEWING",
      barcode: "123",
      product,
      nutritionImageUri: "file:///n.jpg",
      ocrText: null,
      frontImageUri: "file:///f.jpg",
    };
    expect(scanPhaseReducer(state, { type: "RETAKE_STEP" })).toEqual({
      type: "STEP2_CONFIRMED",
      barcode: "123",
      product,
      nutritionImageUri: "file:///n.jpg",
      ocrText: null,
    });
  });

  it("a retaken label photo becomes the new step-2 review", () => {
    const reviewing: ScanPhase = {
      type: "STEP2_REVIEWING",
      barcode: "123",
      product,
      ocrText: "Calories 90",
      imageUri: "file:///n.jpg",
    };
    const prompted = scanPhaseReducer(reviewing, { type: "RETAKE_STEP" });
    expect(
      scanPhaseReducer(prompted, {
        type: "STEP_PHOTO_CAPTURED",
        imageUri: "file:///n2.jpg",
        ocrText: "Calories 100",
      }),
    ).toEqual({
      type: "STEP2_REVIEWING",
      barcode: "123",
      product,
      ocrText: "Calories 100",
      imageUri: "file:///n2.jpg",
    });
  });

  it("is a no-op outside a review step", () => {
    const state: ScanPhase = { type: "HUNTING" };
    expect(scanPhaseReducer(state, { type: "RETAKE_STEP" })).toBe(state);
  });
});

describe("guided-camera reducer additions", () => {
  const product = { name: "Oat Bar" };
  const prompted: ResumablePhase = {
    type: "LABEL_PROMPTED",
    barcode: "123",
    product,
  };
  const confirmed: ResumablePhase = {
    type: "STEP2_CONFIRMED",
    barcode: "123",
    product,
    nutritionImageUri: "file:///n.jpg",
    ocrText: "Calories 100",
  };
  const skipped: ResumablePhase = {
    type: "STEP2_CONFIRMED",
    barcode: "123",
    product,
  };
  const locked: ScanPhase = {
    type: "BARCODE_LOCKED",
    barcode: "123",
    bounds: BOUNDS,
  };

  it("SKIP_STEP from LABEL_PROMPTED → STEP2_CONFIRMED without nutrition keys", () => {
    const result = scanPhaseReducer(prompted, { type: "SKIP_STEP" });
    expect(result).toEqual({
      type: "STEP2_CONFIRMED",
      barcode: "123",
      product,
    });
    expect("nutritionImageUri" in result).toBe(false);
    expect("ocrText" in result).toBe(false);
  });

  it("SKIP_STEP from STEP2_CONFIRMED → SESSION_COMPLETE carrying the nutrition photo", () => {
    expect(scanPhaseReducer(confirmed, { type: "SKIP_STEP" })).toEqual({
      type: "SESSION_COMPLETE",
      barcode: "123",
      nutritionImageUri: "file:///n.jpg",
      ocrText: "Calories 100",
    });
  });

  it("SKIP_STEP from a skipped-nutrition STEP2_CONFIRMED has neither key", () => {
    const result = scanPhaseReducer(skipped, { type: "SKIP_STEP" });
    expect(result).toEqual({ type: "SESSION_COMPLETE", barcode: "123" });
    expect("nutritionImageUri" in result).toBe(false);
    expect("ocrText" in result).toBe(false);
  });

  it("STEP_PHOTO_CAPTURED from skipped STEP2_CONFIRMED → STEP3_REVIEWING without nutritionImageUri", () => {
    const result = scanPhaseReducer(skipped, {
      type: "STEP_PHOTO_CAPTURED",
      imageUri: "file:///f.jpg",
    });
    expect(result).toEqual({
      type: "STEP3_REVIEWING",
      barcode: "123",
      product,
      frontImageUri: "file:///f.jpg",
    });
    expect("nutritionImageUri" in result).toBe(false);
    expect("ocrText" in result).toBe(false);
  });

  it("RETAKE_STEP / CONFIRM_PRODUCT from STEP3_REVIEWING copy nutrition fields only when present", () => {
    const step3: ScanPhase = {
      type: "STEP3_REVIEWING",
      barcode: "123",
      product,
      frontImageUri: "file:///f.jpg",
    };
    const retake = scanPhaseReducer(step3, { type: "RETAKE_STEP" });
    expect(retake).toEqual(skipped);
    expect("nutritionImageUri" in retake).toBe(false);
    const done = scanPhaseReducer(step3, { type: "CONFIRM_PRODUCT" });
    expect(done).toEqual({
      type: "SESSION_COMPLETE",
      barcode: "123",
      frontImageUri: "file:///f.jpg",
    });
    expect("ocrText" in done).toBe(false);
  });

  it("RESCAN from BARCODE_LOCKED → HUNTING", () => {
    expect(scanPhaseReducer(locked, { type: "RESCAN" })).toEqual({
      type: "HUNTING",
    });
  });

  it("RESCAN is ignored in every other phase", () => {
    const others: ScanPhase[] = [
      { type: "IDLE" },
      { type: "HUNTING" },
      { type: "BARCODE_TRACKING", barcode: "1", bounds: BOUNDS, frameCount: 1 },
      prompted,
      { type: "STEP2_REVIEWING", barcode: "1", ocrText: null, imageUri: "u" },
      confirmed,
      { type: "STEP3_REVIEWING", barcode: "1", frontImageUri: "f" },
      { type: "SESSION_COMPLETE", barcode: "1" },
      { type: "CLASSIFYING", imageUri: "u" },
    ];
    for (const s of others) {
      expect(scanPhaseReducer(s, { type: "RESCAN" })).toBe(s);
    }
  });

  it("REDO_STEP barcode from LABEL_PROMPTED → HUNTING with resume", () => {
    expect(
      scanPhaseReducer(prompted, { type: "REDO_STEP", step: "barcode" }),
    ).toEqual({ type: "HUNTING", resume: prompted });
  });

  it("REDO_STEP barcode from STEP2_CONFIRMED → HUNTING with resume", () => {
    expect(
      scanPhaseReducer(confirmed, { type: "REDO_STEP", step: "barcode" }),
    ).toEqual({ type: "HUNTING", resume: confirmed });
  });

  it("REDO_STEP nutrition from STEP2_CONFIRMED → LABEL_PROMPTED keeping barcode and product", () => {
    expect(
      scanPhaseReducer(confirmed, { type: "REDO_STEP", step: "nutrition" }),
    ).toEqual({ type: "LABEL_PROMPTED", barcode: "123", product });
  });

  it("REDO_STEP is ignored outside live-camera step phases", () => {
    const others: ScanPhase[] = [
      locked,
      { type: "STEP2_REVIEWING", barcode: "1", ocrText: null, imageUri: "u" },
      { type: "STEP3_REVIEWING", barcode: "1", frontImageUri: "f" },
      { type: "SESSION_COMPLETE", barcode: "1" },
    ];
    for (const s of others) {
      expect(scanPhaseReducer(s, { type: "REDO_STEP", step: "barcode" })).toBe(
        s,
      );
      expect(
        scanPhaseReducer(s, { type: "REDO_STEP", step: "nutrition" }),
      ).toBe(s);
    }
  });

  it("resume survives FIRST_BARCODE_DETECTED, BARCODE_UPDATED and BARCODE_LOST", () => {
    const hunting: ScanPhase = { type: "HUNTING", resume: confirmed };
    const tracking = scanPhaseReducer(hunting, {
      type: "FIRST_BARCODE_DETECTED",
      barcode: "999",
      bounds: BOUNDS,
    });
    expect(tracking).toMatchObject({
      type: "BARCODE_TRACKING",
      resume: confirmed,
    });
    const updated = scanPhaseReducer(tracking, {
      type: "BARCODE_UPDATED",
      bounds: BOUNDS,
    });
    expect(updated).toMatchObject({ resume: confirmed });
    expect(scanPhaseReducer(updated, { type: "BARCODE_LOST" })).toEqual(
      hunting,
    );
  });

  it("BARCODE_LOCKED with resume of the same barcode returns the resume phase", () => {
    const tracking: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 3,
      resume: confirmed,
    };
    expect(scanPhaseReducer(tracking, { type: "BARCODE_LOCKED" })).toBe(
      confirmed,
    );
  });

  // The saved steps survive a different barcode's found card until the user
  // commits to it: "Not this" must be able to bring them back.
  it("BARCODE_LOCKED with resume of a different barcode keeps the resume on the lock", () => {
    const tracking: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "999",
      bounds: BOUNDS,
      frameCount: 3,
      resume: confirmed,
    };
    expect(scanPhaseReducer(tracking, { type: "BARCODE_LOCKED" })).toEqual({
      type: "BARCODE_LOCKED",
      barcode: "999",
      bounds: BOUNDS,
      resume: confirmed,
    });
  });

  it("RESCAN from a lock that carries a resume restores it on HUNTING", () => {
    const lockedB: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "999",
      bounds: BOUNDS,
      resume: confirmed,
    };
    expect(scanPhaseReducer(lockedB, { type: "RESCAN" })).toEqual({
      type: "HUNTING",
      resume: confirmed,
    });
  });

  it("committing to the new product drops the resume", () => {
    const lockedB: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "999",
      bounds: BOUNDS,
      resume: confirmed,
    };
    const next = scanPhaseReducer(lockedB, { type: "PROCEED_TO_LABEL" });
    expect(next).toEqual({ type: "LABEL_PROMPTED", barcode: "999" });
    const done = scanPhaseReducer(lockedB, { type: "CONFIRM_PRODUCT" });
    expect(done).toEqual({ type: "SESSION_COMPLETE", barcode: "999" });
  });

  it("PRODUCT_LOADED keeps the lock's resume", () => {
    const lockedB: ScanPhase = {
      type: "BARCODE_LOCKED",
      barcode: "999",
      bounds: BOUNDS,
      resume: confirmed,
    };
    expect(
      scanPhaseReducer(lockedB, {
        type: "PRODUCT_LOADED",
        barcode: "999",
        product,
      }),
    ).toMatchObject({ resume: confirmed, product });
  });

  it("CAMERA_READY and RESET drop resume", () => {
    const hunting: ScanPhase = { type: "HUNTING", resume: confirmed };
    expect(scanPhaseReducer(hunting, { type: "CAMERA_READY" })).toEqual({
      type: "HUNTING",
    });
    expect(scanPhaseReducer(hunting, { type: "RESET" })).toEqual({
      type: "IDLE",
    });
  });

  it("MANUAL_BARCODE_ENTERED from HUNTING → BARCODE_LOCKED with manual bounds", () => {
    expect(
      scanPhaseReducer(
        { type: "HUNTING" },
        { type: "MANUAL_BARCODE_ENTERED", barcode: "555" },
      ),
    ).toEqual({
      type: "BARCODE_LOCKED",
      barcode: "555",
      bounds: MANUAL_ENTRY_BOUNDS,
    });
  });

  it("MANUAL_BARCODE_ENTERED obeys resume like BARCODE_LOCKED", () => {
    const hunting: ScanPhase = { type: "HUNTING", resume: confirmed };
    expect(
      scanPhaseReducer(hunting, {
        type: "MANUAL_BARCODE_ENTERED",
        barcode: "123",
      }),
    ).toBe(confirmed);
    const diff = scanPhaseReducer(hunting, {
      type: "MANUAL_BARCODE_ENTERED",
      barcode: "777",
    });
    expect(diff).toEqual({
      type: "BARCODE_LOCKED",
      barcode: "777",
      bounds: MANUAL_ENTRY_BOUNDS,
      resume: confirmed,
    });
  });

  it("MANUAL_BARCODE_ENTERED works from BARCODE_TRACKING", () => {
    const tracking: ScanPhase = {
      type: "BARCODE_TRACKING",
      barcode: "1",
      bounds: BOUNDS,
      frameCount: 2,
    };
    expect(
      scanPhaseReducer(tracking, {
        type: "MANUAL_BARCODE_ENTERED",
        barcode: "555",
      }),
    ).toMatchObject({ type: "BARCODE_LOCKED", barcode: "555" });
  });

  it("MANUAL_BARCODE_ENTERED is ignored outside HUNTING / BARCODE_TRACKING", () => {
    for (const s of [
      locked,
      prompted,
      confirmed,
      { type: "IDLE" } as ScanPhase,
    ]) {
      expect(
        scanPhaseReducer(s, { type: "MANUAL_BARCODE_ENTERED", barcode: "5" }),
      ).toBe(s);
    }
  });

  it("PRODUCT_LOADED for the pre-RESCAN barcode does not attach after MANUAL_BARCODE_ENTERED of a different barcode", () => {
    const hunting = scanPhaseReducer(locked, { type: "RESCAN" });
    const relocked = scanPhaseReducer(hunting, {
      type: "MANUAL_BARCODE_ENTERED",
      barcode: "555",
    });
    expect(
      scanPhaseReducer(relocked, {
        type: "PRODUCT_LOADED",
        barcode: "123",
        product,
      }),
    ).toBe(relocked);
  });
});
