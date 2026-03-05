import { volumeToScale, VOLUME_SILENT } from "../volume-scale";

describe("volumeToScale", () => {
  it("returns 1.0 at silent volume", () => {
    expect(volumeToScale(VOLUME_SILENT, 0.3)).toBeCloseTo(1.0);
  });

  it("returns 1.0 + maxScale at max volume (10)", () => {
    expect(volumeToScale(10, 0.3)).toBeCloseTo(1.3);
    expect(volumeToScale(10, 0.2)).toBeCloseTo(1.2);
  });

  it("scales linearly between min and max", () => {
    // Midpoint of -2..10 is 4
    expect(volumeToScale(4, 0.3)).toBeCloseTo(1.15);
  });

  it("clamps below minimum (-2)", () => {
    expect(volumeToScale(-5, 0.3)).toBeCloseTo(1.0);
  });

  it("clamps above maximum (10)", () => {
    expect(volumeToScale(15, 0.3)).toBeCloseTo(1.3);
  });

  it("handles zero volume", () => {
    // 0 is 2 above -2, so (2/12) * 0.3 = 0.05
    expect(volumeToScale(0, 0.3)).toBeCloseTo(1.05);
  });
});

describe("VOLUME_SILENT", () => {
  it("is -2", () => {
    expect(VOLUME_SILENT).toBe(-2);
  });
});
