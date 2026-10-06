/**
 * Positive controls for the nightly eval compare step. Each rule is tripped
 * by its OWN doctored run while the other two stay satisfied, and an
 * unchanged run passes — so a rule that silently stopped firing would fail
 * here, not in a 3 a.m. workflow run.
 */
import { describe, it, expect } from "vitest";
import {
  comparePaired,
  PAIRED_THRESHOLDS,
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

  it("rule 1: overall mean below the baseline lower bound fails alone", () => {
    // Accuracy 3 points lower on every case, safety and assertions unchanged:
    // the per-case means collapse, so only rule 1 may fire.
    const bad = makeRun({
      safety: good.cases.map((c) => c.rubricScores[0].score),
      accuracy: good.cases.map((c) => c.rubricScores[1].score - 3),
    });
    const r = compareSuite(bad, baseline);
    expect(r.failures).toEqual([expect.stringMatching(/^overall: /)]);
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

function run(
  cases: [string, Record<string, number>, boolean][],
  samplesPerCase = 1,
): RunLike {
  return {
    runId: "r",
    judgeModel: "j",
    totalCases: cases.length,
    samplesPerCase,
    assertionPassRate: 1,
    weightedOverall: 0,
    dimensionConfidenceIntervals: {},
    cases: cases.map(([id, scores, passed]) => ({
      testCaseId: id,
      rubricScores: Object.entries(scores).map(([dimension, score]) => ({
        dimension,
        score,
      })),
      assertions: { passed },
    })),
  };
}

describe("comparePaired", () => {
  it("identical runs pass with zero differences", () => {
    const r = run([
      ["a", { accuracy: 7, safety: 9 }, true],
      ["b", { accuracy: 6, safety: 8 }, true],
    ]);
    const res = comparePaired(r, r);
    expect(res.passed).toBe(true);
    for (const d of res.dimensions) expect(d.mean).toBe(0);
  });

  it("a uniform -1.0 drop fails every dimension", () => {
    const base = run([
      ["a", { accuracy: 7 }, true],
      ["b", { accuracy: 6 }, true],
    ]);
    const cand = run([
      ["a", { accuracy: 6 }, true],
      ["b", { accuracy: 5 }, true],
    ]);
    const res = comparePaired(base, cand);
    expect(res.dimensions[0]).toMatchObject({
      dimension: "accuracy",
      mean: -1,
      lower: -1,
      pass: false,
    });
    expect(res.passed).toBe(false);
  });

  it("safety uses the stricter -0.25 bar", () => {
    const base = run([
      ["a", { safety: 9 }, true],
      ["b", { safety: 9 }, true],
    ]);
    const cand = run([
      ["a", { safety: 8.6 }, true],
      ["b", { safety: 8.6 }, true],
    ]); // -0.4
    const res = comparePaired(base, cand);
    expect(res.dimensions[0].threshold).toBe(PAIRED_THRESHOLDS.safety);
    expect(res.dimensions[0].pass).toBe(false);
  });

  it("pools samples per case before differencing (#n suffix)", () => {
    const base = run(
      [
        ["a#1", { accuracy: 6 }, true],
        ["a#2", { accuracy: 8 }, true],
      ],
      2,
    ); // mean 7
    const cand = run(
      [
        ["a#1", { accuracy: 7 }, true],
        ["a#2", { accuracy: 7 }, true],
      ],
      2,
    ); // mean 7
    expect(comparePaired(base, cand).dimensions[0].mean).toBe(0);
  });

  it("a case passing on baseline but failing on candidate fails the run", () => {
    const base = run([["a", { accuracy: 7 }, true]]);
    const cand = run([["a", { accuracy: 7 }, false]]);
    const res = comparePaired(base, cand);
    expect(res.newAssertionFailures).toEqual(["a"]);
    expect(res.passed).toBe(false);
  });

  it("cases missing from either run are reported and fail the run", () => {
    const base = run([
      ["a", { accuracy: 7 }, true],
      ["b", { accuracy: 7 }, true],
    ]);
    const cand = run([["a", { accuracy: 7 }, true]]);
    const res = comparePaired(base, cand);
    expect(res.missingCases).toEqual(["b"]);
    expect(res.passed).toBe(false);
  });
});
