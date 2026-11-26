import { describe, it, expect } from "vitest";
import type { ScanPhase } from "../../types/scan-phase";
import { getBarcodeFlowView, getPhotosDiscardedByLock } from "../barcode-flow";

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

  it("SESSION_COMPLETE: every tab done, none tappable", () => {
    const p: ScanPhase = { type: "SESSION_COMPLETE", barcode: "1" };
    expect(states(p)).toEqual(["done", "done", "done"]);
    expect(tappable(p)).toEqual([false, false, false]);
  });

  it("smart-scan phases map to the generic single-step view", () => {
    const v = getBarcodeFlowView({ type: "CLASSIFYING", imageUri: "u" }, opts);
    expect(v.tabs).toEqual([]);
    expect(v.frame).toBe("photo");
    expect(v.showShutter).toBe(true);
    expect(v.exampleKey).toBeNull();
  });
});

describe("getPhotosDiscardedByLock", () => {
  const resume = {
    type: "STEP2_CONFIRMED" as const,
    barcode: "A",
    nutritionImageUri: "file:///a-nutrition.jpg",
  };
  const locked = (barcode: string): ScanPhase => ({
    type: "BARCODE_LOCKED",
    barcode,
    bounds: BOUNDS,
  });

  it("returns the resume nutrition URI for a different barcode", () => {
    expect(
      getPhotosDiscardedByLock({ type: "HUNTING", resume }, locked("B")),
    ).toEqual(["file:///a-nutrition.jpg"]);
    expect(
      getPhotosDiscardedByLock(
        {
          type: "BARCODE_TRACKING",
          barcode: "B",
          bounds: BOUNDS,
          frameCount: 7,
          resume,
        },
        locked("B"),
      ),
    ).toEqual(["file:///a-nutrition.jpg"]);
  });

  it("returns [] for the same barcode", () => {
    expect(
      getPhotosDiscardedByLock({ type: "HUNTING", resume }, locked("A")),
    ).toEqual([]);
  });

  it("returns [] without resume, or when the next phase is not a plain lock", () => {
    expect(getPhotosDiscardedByLock({ type: "HUNTING" }, locked("B"))).toEqual(
      [],
    );
    expect(
      getPhotosDiscardedByLock(
        { type: "HUNTING", resume },
        { type: "HUNTING" },
      ),
    ).toEqual([]);
  });

  it("returns [] when the resume held no photo", () => {
    expect(
      getPhotosDiscardedByLock(
        { type: "HUNTING", resume: { type: "LABEL_PROMPTED", barcode: "A" } },
        locked("B"),
      ),
    ).toEqual([]);
  });
});
