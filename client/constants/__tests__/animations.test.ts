import { describe, it, expect, vi, beforeEach } from "vitest";
import { FadeInDown } from "react-native-reanimated";
import * as animations from "../animations";
import {
  listEntrance,
  listStaggerMaxIndex,
  listStaggerStep,
} from "../animations";

describe("listEntrance", () => {
  let delaySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    delaySpy = vi.spyOn(FadeInDown, "delay");
  });

  it("staggers each row by one step", () => {
    listEntrance(0, false);
    listEntrance(3, false);
    expect(delaySpy.mock.calls).toEqual([[0], [3 * listStaggerStep]]);
  });

  it("caps the delay so a long list never waits", () => {
    listEntrance(listStaggerMaxIndex + 5, false);
    expect(delaySpy).toHaveBeenCalledWith(
      listStaggerMaxIndex * listStaggerStep,
    );
  });

  it("returns no animation under reduced motion", () => {
    expect(listEntrance(2, true)).toBeUndefined();
    expect(delaySpy).not.toHaveBeenCalled();
  });
});

// Reanimated 4 fills any spring option you omit from its own defaults
// (mass 4), so a config that lists damping/stiffness but no mass runs far
// slower and bouncier than its numbers read. Duration mode ignores mass.
describe("spring configs", () => {
  const springs = Object.entries(animations).filter(
    ([, value]) =>
      typeof value === "object" &&
      value !== null &&
      ("damping" in value || "stiffness" in value || "mass" in value),
  );

  it("finds the spring configs (the guard below is not vacuous)", () => {
    expect(springs.length).toBeGreaterThanOrEqual(10);
  });

  it.each(springs)("%s states mass explicitly", (_name, value) => {
    const spring = value as Record<string, unknown>;
    if ("duration" in spring) return;
    expect(spring.mass).toEqual(expect.any(Number));
  });
});
