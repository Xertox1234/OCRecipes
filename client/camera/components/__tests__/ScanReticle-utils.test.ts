import { describe, it, expect } from "vitest";
import {
  getReticleTarget,
  getConfidenceFromPhase,
  BARCODE_RETICLE,
  LABEL_RETICLE,
} from "../ScanReticle-utils";

const BOUNDS = { x: 0.3, y: 0.4, width: 0.4, height: 0.2 };
const SW = 390;
const SH = 844;

describe("getReticleTarget", () => {
  it("returns barcode-shaped centered target for IDLE", () => {
    const t = getReticleTarget({ type: "IDLE" }, SW, SH);
    expect(t.cx).toBe(SW / 2);
    expect(t.cy).toBe(SH / 2);
    expect(t.width).toBe(BARCODE_RETICLE.width);
    expect(t.height).toBe(BARCODE_RETICLE.height);
  });

  it("returns barcode-shaped centered target for HUNTING", () => {
    const t = getReticleTarget({ type: "HUNTING" }, SW, SH);
    expect(t.width).toBe(BARCODE_RETICLE.width);
    expect(t.height).toBe(BARCODE_RETICLE.height);
  });

  it("tracks barcode position in BARCODE_TRACKING", () => {
    const t = getReticleTarget(
      {
        type: "BARCODE_TRACKING",
        barcode: "123",
        bounds: BOUNDS,
        frameCount: 3,
      },
      SW,
      SH,
    );
    // cx = (0.3 + 0.4/2) * 390 = (0.5) * 390 = 195
    expect(t.cx).toBeCloseTo(195);
    // cy = (0.4 + 0.2/2) * 844 = (0.5) * 844 = 422
    expect(t.cy).toBeCloseTo(422);
  });

  it("locks to barcode position in BARCODE_LOCKED", () => {
    const t = getReticleTarget(
      { type: "BARCODE_LOCKED", barcode: "123", bounds: BOUNDS },
      SW,
      SH,
    );
    expect(t.cx).toBeCloseTo(195);
    expect(t.cy).toBeCloseTo(422);
  });

  it("returns label-shaped centered target for STEP2_CAPTURING", () => {
    const t = getReticleTarget(
      { type: "STEP2_CAPTURING", barcode: "123" },
      SW,
      SH,
    );
    expect(t.cx).toBe(SW / 2);
    expect(t.cy).toBe(SH / 2);
    expect(t.width).toBe(LABEL_RETICLE.width);
    expect(t.height).toBe(LABEL_RETICLE.height);
  });

  it("returns label-shaped target for STEP3_CAPTURING", () => {
    const t = getReticleTarget(
      {
        type: "STEP3_CAPTURING",
        barcode: "123",
        nutritionImageUri: "x",
        ocrText: "",
      },
      SW,
      SH,
    );
    expect(t.width).toBe(LABEL_RETICLE.width);
  });
});

describe("getConfidenceFromPhase", () => {
  it("returns 0 for IDLE and HUNTING", () => {
    expect(getConfidenceFromPhase({ type: "IDLE" })).toBe(0);
    expect(getConfidenceFromPhase({ type: "HUNTING" })).toBe(0);
  });

  it("normalizes frameCount: 7 frames = 1.0", () => {
    const phase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 7,
    } as const;
    expect(getConfidenceFromPhase(phase)).toBe(1.0);
  });

  it("normalizes frameCount: 3 frames ≈ 0.43", () => {
    const phase = {
      type: "BARCODE_TRACKING",
      barcode: "123",
      bounds: BOUNDS,
      frameCount: 3,
    } as const;
    expect(getConfidenceFromPhase(phase)).toBeCloseTo(0.43, 1);
  });

  it("returns 1.0 for BARCODE_LOCKED and beyond", () => {
    expect(
      getConfidenceFromPhase({
        type: "BARCODE_LOCKED",
        barcode: "123",
        bounds: BOUNDS,
      }),
    ).toBe(1.0);
    expect(
      getConfidenceFromPhase({ type: "STEP2_CAPTURING", barcode: "123" }),
    ).toBe(1.0);
  });
});
