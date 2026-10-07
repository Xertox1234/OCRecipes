import { describe, it, expect } from "vitest";
import {
  scoreProbe,
  type ProbeRun,
  type ProbeSet,
} from "../probe-offer-recipe";

const runs3 = (id: string, set: ProbeSet, called: boolean[]): ProbeRun[] =>
  called.map((c) => ({ id, set, called: c, reachedToolLoop: true }));

describe("scoreProbe", () => {
  it("counts majority-of-3 per case and applies the pass bar", () => {
    const runs: ProbeRun[] = [
      ...Array.from({ length: 9 }, (_, i) =>
        runs3(`a${i}`, "ask", [true, true, false]),
      ).flat(),
      ...runs3("r0", "recipe_negative", [false, false, false]),
      ...runs3("c0", "coach_negative", [true, true, false]),
      ...runs3("c1", "coach_negative", [false, false, false]),
    ];
    const report = scoreProbe(runs);
    expect(report.ask).toEqual({ majority: 9, total: 9 });
    expect(report.coach_negative).toEqual({ majority: 1, total: 2 });
    expect(report.pass).toBe(true);
  });

  it("a recipe_negative that never reaches the tool loop is not a false alarm", () => {
    const runs: ProbeRun[] = [
      {
        id: "r0",
        set: "recipe_negative",
        called: true,
        reachedToolLoop: false,
      },
    ];
    expect(scoreProbe(runs).recipe_negative.majority).toBe(0);
  });

  it("fails the bar on a recipe_negative false alarm or ask < 8", () => {
    const base: ProbeRun[] = Array.from({ length: 9 }, (_, i) =>
      runs3(`a${i}`, "ask", [true, true, true]),
    ).flat();
    const falseAlarm = scoreProbe([
      ...base,
      ...runs3("r0", "recipe_negative", [true, true, false]),
    ]);
    expect(falseAlarm.recipe_negative.majority).toBe(1);
    expect(falseAlarm.pass).toBe(false);

    const weak: ProbeRun[] = [
      ...Array.from({ length: 2 }, (_, i) =>
        runs3(`w${i}`, "ask", [false, false, true]),
      ).flat(),
      ...Array.from({ length: 7 }, (_, i) =>
        runs3(`s${i}`, "ask", [true, true, true]),
      ).flat(),
    ];
    const report = scoreProbe(weak);
    expect(report.ask).toEqual({ majority: 7, total: 9 });
    expect(report.pass).toBe(false);
  });
});
