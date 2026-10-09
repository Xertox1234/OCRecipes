import { describe, it, expect, vi, beforeEach } from "vitest";
import { FadeInDown } from "react-native-reanimated";
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
