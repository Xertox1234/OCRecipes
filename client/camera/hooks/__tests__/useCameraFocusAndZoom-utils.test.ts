import { describe, it, expect } from "vitest";
import { clampZoom } from "../useCameraFocusAndZoom-utils";

describe("clampZoom", () => {
  it("returns the value unchanged when within range", () => {
    expect(clampZoom(2, 1, 5)).toBe(2);
  });

  it("clamps to the minimum when below range", () => {
    expect(clampZoom(0.5, 1, 5)).toBe(1);
  });

  it("clamps to the maximum when above range", () => {
    expect(clampZoom(10, 1, 5)).toBe(5);
  });

  it("handles min === max (single-zoom-level device)", () => {
    expect(clampZoom(3, 1, 1)).toBe(1);
  });
});
