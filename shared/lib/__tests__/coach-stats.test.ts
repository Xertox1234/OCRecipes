import { describe, it, expect } from "vitest";
import { remainingCaloriesStat, selectTopInsights } from "../coach-stats";

describe("selectTopInsights", () => {
  const tip = (content: string, type = "insight") => ({ type, content });

  it("keeps only insights, newest first, up to the limit", () => {
    const picked = selectTopInsights(
      [
        tip("a", "goal"),
        tip("Eat more fibre"),
        tip("Drink water"),
        tip("Walk"),
      ],
      2,
    );
    expect(picked.map((p) => p.content)).toEqual([
      "Eat more fibre",
      "Drink water",
    ]);
  });

  it("drops a tip that repeats an earlier one ignoring case and the full stop", () => {
    const picked = selectTopInsights([
      tip("Drink water."),
      tip("drink   water"),
    ]);
    expect(picked).toHaveLength(1);
  });

  it("drops a longer tip that contains an earlier one of 20+ characters", () => {
    const base = "Protein at breakfast keeps you full";
    const picked = selectTopInsights([
      tip(base),
      tip(`${base}, especially eggs`),
    ]);
    expect(picked).toHaveLength(1);
  });
});

describe("remainingCaloriesStat", () => {
  it("shows what is left as a grouped whole number", () => {
    expect(remainingCaloriesStat(1949, 820)).toEqual({
      value: "1,129",
      label: "Remaining",
    });
  });

  it("shows how far over without a minus sign", () => {
    expect(remainingCaloriesStat(1949, 2100)).toEqual({
      value: "151",
      label: "Over",
    });
  });

  it("never prints -0 just past the goal", () => {
    expect(remainingCaloriesStat(1949, 1949.2)).toEqual({
      value: "0",
      label: "Remaining",
    });
  });
});
