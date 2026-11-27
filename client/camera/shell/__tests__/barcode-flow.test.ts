import { describe, it, expect } from "vitest";
import type { ScanPhase } from "../../types/scan-phase";
import {
  getBarcodeFlowView,
  getPhotosDiscardedByCommit,
} from "../barcode-flow";

const BOUNDS = { x: 0.3, y: 0.4, width: 0.4, height: 0.2 };
const opts = { returnAfterLog: false };
const states = (p: ScanPhase, o = opts) =>
  getBarcodeFlowView(p, o).tabs.map((t) => t.state);
const tappable = (p: ScanPhase, o = opts) =>
  getBarcodeFlowView(p, o).tabs.map((t) => t.tappable);

describe("getBarcodeFlowView", () => {
  it("HUNTING: barcode tab active, barcode frame, no shutter or skip", () => {
    const v = getBarcodeFlowView({ type: "HUNTING" }, opts);
    expect(v.tabs.map((t) => t.label)).toEqual([
      "Barcode",
      "Nutrition",
      "Front",
    ]);
    expect(v.tabs[2].sublabel).toBe("optional");
    expect(states({ type: "HUNTING" })).toEqual([
      "active",
      "upcoming",
      "upcoming",
    ]);
    expect(v.frame).toBe("barcode");
    expect(v.hint).toBe("Line the barcode up inside the frame");
    expect(v.showShutter).toBe(false);
    expect(v.showSkip).toBe(false);
    expect(v.exampleKey).toBe("barcode");
  });

  it("LABEL_PROMPTED: nutrition active, barcode done and tappable", () => {
    const p: ScanPhase = { type: "LABEL_PROMPTED", barcode: "1" };
    const v = getBarcodeFlowView(p, opts);
    expect(states(p)).toEqual(["done", "active", "upcoming"]);
    expect(v.tabs[0].tappable).toBe(true);
    expect(v.frame).toBe("label");
    expect(v.hint).toBe("Fit the whole panel in the frame");
    expect(v.showShutter).toBe(true);
    expect(v.showSkip).toBe(true);
    expect(v.exampleKey).toBe("barcode-nutrition");
  });

  it("STEP2_CONFIRMED: front active (optional), earlier tabs done and tappable", () => {
    const p: ScanPhase = {
      type: "STEP2_CONFIRMED",
      barcode: "1",
      nutritionImageUri: "file:///n.jpg",
    };
    const v = getBarcodeFlowView(p, opts);
    expect(states(p)).toEqual(["done", "done", "active"]);
    expect(tappable(p)).toEqual([true, true, false]);
    expect(v.tabs[2].sublabel).toBe("optional");
    expect(v.frame).toBe("front");
    expect(v.hint).toBe("Fit the front of the package in the frame");
    expect(v.showShutter).toBe(true);
    expect(v.showSkip).toBe(true);
    expect(v.exampleKey).toBe("barcode-front");
  });

  it("STEP2_CONFIRMED with skipped nutrition: nutrition upcoming but tappable", () => {
    const p: ScanPhase = { type: "STEP2_CONFIRMED", barcode: "1" };
    expect(states(p)).toEqual(["done", "upcoming", "active"]);
    expect(tappable(p)).toEqual([true, true, false]);
  });

  it("BARCODE_LOCKED, STEP2_REVIEWING and STEP3_REVIEWING: no tab is tappable", () => {
    const phases: ScanPhase[] = [
      { type: "BARCODE_LOCKED", barcode: "1", bounds: BOUNDS },
      { type: "STEP2_REVIEWING", barcode: "1", ocrText: "x", imageUri: "u" },
      {
        type: "STEP3_REVIEWING",
        barcode: "1",
        nutritionImageUri: "n",
        frontImageUri: "f",
      },
    ];
    for (const p of phases) {
      const v = getBarcodeFlowView(p, opts);
      expect(v.tabs.some((t) => t.tappable)).toBe(false);
      expect(v.showShutter).toBe(false);
      expect(v.showSkip).toBe(false);
    }
  });

  it("returnAfterLog: only the barcode tab, in every phase", () => {
    const phases: ScanPhase[] = [
      { type: "IDLE" },
      { type: "HUNTING" },
      { type: "BARCODE_LOCKED", barcode: "1", bounds: BOUNDS },
      { type: "LABEL_PROMPTED", barcode: "1" },
      { type: "STEP2_CONFIRMED", barcode: "1" },
      { type: "SESSION_COMPLETE", barcode: "1" },
    ];
    for (const p of phases) {
      const v = getBarcodeFlowView(p, { returnAfterLog: true });
      expect(v.tabs.map((t) => t.id)).toEqual(["barcode"]);
    }
  });

  it("SESSION_COMPLETE: photographed steps done, skipped ones not, none tappable", () => {
    const all: ScanPhase = {
      type: "SESSION_COMPLETE",
      barcode: "1",
      nutritionImageUri: "n",
      frontImageUri: "f",
    };
    expect(states(all)).toEqual(["done", "done", "done"]);
    expect(tappable(all)).toEqual([false, false, false]);
    const skipped: ScanPhase = { type: "SESSION_COMPLETE", barcode: "1" };
    expect(states(skipped)).toEqual(["done", "upcoming", "upcoming"]);
    expect(
      states({ type: "SESSION_COMPLETE", barcode: "1", frontImageUri: "f" }),
    ).toEqual(["done", "upcoming", "done"]);
  });

  it("smart-scan phases map to the generic single-step view", () => {
    const v = getBarcodeFlowView({ type: "CLASSIFYING", imageUri: "u" }, opts);
    expect(v.tabs).toEqual([]);
    expect(v.frame).toBe("photo");
    expect(v.showShutter).toBe(true);
    expect(v.exampleKey).toBeNull();
  });
});

// A different barcode's found card keeps the saved steps (resume) until the
// user commits to the new product; only then are the old photos discarded.
describe("getPhotosDiscardedByCommit", () => {
  const resume = {
    type: "STEP2_CONFIRMED" as const,
    barcode: "A",
    nutritionImageUri: "file:///a-nutrition.jpg",
  };
  const lockedB: ScanPhase = {
    type: "BARCODE_LOCKED",
    barcode: "B",
    bounds: BOUNDS,
    resume,
  };

  it("returns the resumed photo when the user moves on from B's found card", () => {
    const forward: ScanPhase[] = [
      { type: "LABEL_PROMPTED", barcode: "B" },
      { type: "SESSION_COMPLETE", barcode: "B" },
      { type: "STEP2_REVIEWING", barcode: "B", ocrText: null, imageUri: "u" },
    ];
    for (const next of forward) {
      expect(getPhotosDiscardedByCommit(lockedB, next)).toEqual([
        "file:///a-nutrition.jpg",
      ]);
    }
  });

  it("returns [] for Not this, a product load, or leaving the screen", () => {
    expect(
      getPhotosDiscardedByCommit(lockedB, { type: "HUNTING", resume }),
    ).toEqual([]);
    expect(getPhotosDiscardedByCommit(lockedB, lockedB)).toEqual([]);
    expect(getPhotosDiscardedByCommit(lockedB, { type: "IDLE" })).toEqual([]);
  });

  it("returns [] for a lock with no resume, or a resume with no photo", () => {
    expect(
      getPhotosDiscardedByCommit(
        { type: "BARCODE_LOCKED", barcode: "B", bounds: BOUNDS },
        { type: "LABEL_PROMPTED", barcode: "B" },
      ),
    ).toEqual([]);
    expect(
      getPhotosDiscardedByCommit(
        { ...lockedB, resume: { type: "LABEL_PROMPTED", barcode: "A" } },
        { type: "LABEL_PROMPTED", barcode: "B" },
      ),
    ).toEqual([]);
  });
});
