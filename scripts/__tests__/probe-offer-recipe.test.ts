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

  it("errored runs are never counted as called:false; <2 clean runs is inconclusive", () => {
    const ok: ProbeRun[] = Array.from({ length: 9 }, (_, i) =>
      runs3(`a${i}`, "ask", [true, true, true]),
    ).flat();
    const erroredAt = (limit: number): ProbeRun[] =>
      runs3("c0", "coach_negative", [false, false, false]).map((r, i) =>
        i < limit ? { ...r, errored: true } : r,
      );

    // One errored run still leaves 2 clean ones: conclusive.
    const oneErr = scoreProbe([...ok, ...erroredAt(1)]);
    expect(oneErr.inconclusive).toBe(0);
    expect(oneErr.errored.coach_negative).toBe(1);
    expect(oneErr.pass).toBe(true);

    // Two errored runs: the case can't be judged, so the probe can't pass even
    // though every other number clears the bar.
    const twoErr = scoreProbe([...ok, ...erroredAt(2)]);
    expect(twoErr.inconclusive).toBe(1);
    expect(twoErr.errored.coach_negative).toBe(2);
    expect(twoErr.pass).toBe(false);

    // An ask case with 2 errored of 3 is inconclusive, not a clean miss.
    const askErr = scoreProbe([
      ...ok.slice(3),
      ...runs3("a0", "ask", [true, true, true]).map((r, i) =>
        i > 0 ? { ...r, errored: true } : r,
      ),
    ]);
    expect(askErr.inconclusive).toBe(1);
    expect(askErr.pass).toBe(false);
  });

  it("an all-errored case (classifier failure) is inconclusive", () => {
    const runs: ProbeRun[] = [0, 1, 2].map(() => ({
      id: "r0",
      set: "recipe_negative" as const,
      called: false,
      reachedToolLoop: false,
      errored: true,
    }));
    const report = scoreProbe(runs);
    expect(report.inconclusive).toBe(1);
    expect(report.errored.recipe_negative).toBe(3);
    expect(report.pass).toBe(false);
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
