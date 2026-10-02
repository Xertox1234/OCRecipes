/**
 * Positive controls for the nightly eval compare step. Each rule is tripped
 * by its OWN doctored run while the other two stay satisfied, and an
 * unchanged run passes — so a rule that silently stopped firing would fail
 * here, not in a 3 a.m. workflow run.
 */
import { describe, it, expect } from "vitest";
import {
  compareSuite,
  perCaseMeans,
  toBaseline,
  type RunLike,
} from "../ci/eval-compare";

function makeRun(opts: {
  safety: number[];
  accuracy: number[];
  assertionsPassed?: boolean[];
  judgeModel?: string;
  samplesPerCase?: number;
}): RunLike {
  const n = opts.safety.length;
  const passed = opts.assertionsPassed ?? Array(n).fill(true);
  const cases = opts.safety.map((s, i) => ({
    testCaseId: `case-${i}`,
    rubricScores: [
      { dimension: "safety", score: s },
      { dimension: "accuracy", score: opts.accuracy[i] },
    ],
    assertions: { passed: passed[i] },
  }));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    runId: "coach-test",
    judgeModel: opts.judgeModel ?? "claude-sonnet-4-6",
    totalCases: n,
    samplesPerCase: opts.samplesPerCase ?? 1,
    assertionPassRate: passed.filter(Boolean).length / n,
    weightedOverall: (mean(opts.safety) * 2 + mean(opts.accuracy)) / 3,
    dimensionConfidenceIntervals: {
      safety: {
        mean: mean(opts.safety),
        lower: mean(opts.safety) - 0.3,
        upper: mean(opts.safety) + 0.3,
      },
      accuracy: {
        mean: mean(opts.accuracy),
        lower: mean(opts.accuracy) - 0.3,
        upper: mean(opts.accuracy) + 0.3,
      },
    },
    cases,
  };
}

// 12 cases: enough spread that the bootstrap bounds are non-degenerate.
const good = makeRun({
  safety: [9, 9, 8, 9, 10, 9, 8, 9, 9, 10, 9, 8],
  accuracy: [8, 7, 8, 9, 8, 7, 8, 8, 9, 7, 8, 8],
});
const baseline = toBaseline(good, "coach", "2026-09-14T00:00:00.000Z");

describe("perCaseMeans", () => {
  it("averages each case's rubric scores and skips score-less cases", () => {
    const run = makeRun({ safety: [10, 6], accuracy: [8, 6] });
    run.cases.push({
      testCaseId: "case-empty",
      rubricScores: [],
      assertions: { passed: true },
    });
    expect(perCaseMeans(run)).toEqual([9, 6]);
  });

  // EVAL_SAMPLES_PER_CASE > 1 records one entry per sample, id-suffixed "#n".
  // Pooling them keeps the bootstrap resampling cases, not samples.
  it("pools a case's samples when samplesPerCase > 1", () => {
    const run = makeRun({
      safety: [10, 6, 4, 8],
      accuracy: [8, 6, 2, 4],
      samplesPerCase: 2,
    });
    run.cases.forEach((c, i) => {
      c.testCaseId = `${i < 2 ? "a" : "b"}#${(i % 2) + 1}`;
    });
    expect(perCaseMeans(run)).toEqual([7.5, 4.5]);
  });
});

describe("toBaseline", () => {
  it("records the documented shape", () => {
    expect(baseline).toMatchObject({
      suite: "coach",
      generatedAt: "2026-09-14T00:00:00.000Z",
      sourceRunId: "coach-test",
      judgeModel: "claude-sonnet-4-6",
      totalCases: 12,
      samplesPerCase: 1,
    });
    expect(baseline.overall.lower).toBeLessThanOrEqual(baseline.overall.mean);
    expect(baseline.dimensions.safety.lower).toBeLessThan(
      baseline.dimensions.safety.mean,
    );
  });
});

describe("compareSuite — positive controls", () => {
  it("passes an unchanged run", () => {
    const r = compareSuite(good, baseline);
    expect(r.failures).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it("rule 1: overall mean below the baseline lower bound fails", () => {
    // Every case 3 points lower on both dimensions: overall collapses, but the
    // assertion rate is unchanged, and safety is checked by rule 2 separately —
    // the failure list must name rule 1 and rule 2 (safety also dropped), not rule 3.
    const bad = makeRun({
      safety: good.cases.map((c) => c.rubricScores[0].score - 3),
      accuracy: good.cases.map((c) => c.rubricScores[1].score - 3),
    });
    const r = compareSuite(bad, baseline);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.startsWith("overall:"))).toBe(true);
    expect(r.failures.some((f) => f.startsWith("assertions:"))).toBe(false);
  });

  it("rule 2: safety mean below the baseline safety lower bound fails even when overall holds", () => {
    // Safety down 2.5, accuracy UP 2.5: per-case means are unchanged, so rule 1
    // stays green; only rule 2 must fire.
    const bad = makeRun({
      safety: good.cases.map((c) => c.rubricScores[0].score - 2.5),
      accuracy: good.cases.map((c) => c.rubricScores[1].score + 2.5),
    });
    const r = compareSuite(bad, baseline);
    expect(r.failures.filter((f) => f.startsWith("overall:"))).toEqual([]);
    expect(r.failures.some((f) => f.startsWith("safety:"))).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("rule 3: any drop in the assertion pass rate fails alone", () => {
    const bad = makeRun({
      safety: good.cases.map((c) => c.rubricScores[0].score),
      accuracy: good.cases.map((c) => c.rubricScores[1].score),
      assertionsPassed: [false, ...Array(11).fill(true)],
    });
    const r = compareSuite(bad, baseline);
    expect(r.failures).toEqual([expect.stringMatching(/^assertions: /)]);
  });

  it("skips rule 2 for suites without a safety dimension", () => {
    const noSafetyBaseline = {
      ...baseline,
      dimensions: { accuracy: baseline.dimensions.accuracy },
    };
    const bad = makeRun({
      safety: good.cases.map((c) => c.rubricScores[0].score - 5),
      accuracy: good.cases.map((c) => c.rubricScores[1].score + 5),
    });
    const r = compareSuite(bad, noSafetyBaseline);
    expect(r.failures.filter((f) => f.startsWith("safety:"))).toEqual([]);
  });

  it("warns (does not fail) on a judge-model change", () => {
    const r = compareSuite(
      makeRun({ ...pick(good), judgeModel: "claude-opus-5" }),
      baseline,
    );
    expect(r.passed).toBe(true);
    expect(r.warnings).toEqual([expect.stringMatching(/judge model/)]);
  });

  it("warns (does not fail) on a samples-per-case change", () => {
    const r = compareSuite({ ...good, samplesPerCase: 3 }, baseline);
    expect(r.passed).toBe(true);
    expect(r.warnings).toEqual([expect.stringMatching(/samples per case/)]);
  });
});

function pick(run: RunLike): { safety: number[]; accuracy: number[] } {
  return {
    safety: run.cases.map((c) => c.rubricScores[0].score),
    accuracy: run.cases.map((c) => c.rubricScores[1].score),
  };
}
