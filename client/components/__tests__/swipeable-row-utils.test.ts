import { evaluateSwipeThresholdCrossing } from "../swipeable-row-utils";

const THRESHOLD = 80;

describe("evaluateSwipeThresholdCrossing — right container (positive drag)", () => {
  it("fires on first crossing", () => {
    const result = evaluateSwipeThresholdCrossing(
      100,
      THRESHOLD,
      "right",
      false,
    );
    expect(result).toEqual({ shouldFireHaptic: true, nextFired: true });
  });

  it("does not fire again while still past threshold", () => {
    const result = evaluateSwipeThresholdCrossing(
      110,
      THRESHOLD,
      "right",
      true,
    );
    expect(result).toEqual({ shouldFireHaptic: false, nextFired: true });
  });

  it("resets the guard when the drag returns under threshold", () => {
    const result = evaluateSwipeThresholdCrossing(40, THRESHOLD, "right", true);
    expect(result).toEqual({ shouldFireHaptic: false, nextFired: false });
  });

  it("fires again after re-crossing following a reset", () => {
    const result = evaluateSwipeThresholdCrossing(
      90,
      THRESHOLD,
      "right",
      false,
    );
    expect(result).toEqual({ shouldFireHaptic: true, nextFired: true });
  });

  it("does not fire for a negative (opposite-direction) drag", () => {
    const result = evaluateSwipeThresholdCrossing(
      -100,
      THRESHOLD,
      "right",
      false,
    );
    expect(result).toEqual({ shouldFireHaptic: false, nextFired: false });
  });

  it("does not fire exactly at rest (0)", () => {
    const result = evaluateSwipeThresholdCrossing(0, THRESHOLD, "right", false);
    expect(result).toEqual({ shouldFireHaptic: false, nextFired: false });
  });
});

describe("evaluateSwipeThresholdCrossing — left container (negative drag)", () => {
  it("fires on first crossing", () => {
    const result = evaluateSwipeThresholdCrossing(
      -100,
      THRESHOLD,
      "left",
      false,
    );
    expect(result).toEqual({ shouldFireHaptic: true, nextFired: true });
  });

  it("does not fire again while still past threshold", () => {
    const result = evaluateSwipeThresholdCrossing(
      -110,
      THRESHOLD,
      "left",
      true,
    );
    expect(result).toEqual({ shouldFireHaptic: false, nextFired: true });
  });

  it("resets the guard when the drag returns under threshold", () => {
    const result = evaluateSwipeThresholdCrossing(-40, THRESHOLD, "left", true);
    expect(result).toEqual({ shouldFireHaptic: false, nextFired: false });
  });

  it("does not fire for a positive (opposite-direction) drag", () => {
    const result = evaluateSwipeThresholdCrossing(
      100,
      THRESHOLD,
      "left",
      false,
    );
    expect(result).toEqual({ shouldFireHaptic: false, nextFired: false });
  });
});
