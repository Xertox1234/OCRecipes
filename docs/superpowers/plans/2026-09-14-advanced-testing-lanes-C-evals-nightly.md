# Lane C — Nightly LLM Evals with Regression Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run all five eval suites nightly in CI, compare each run against a committed baseline with three regression rules, file an issue on regression, and refresh baselines only through a human-reviewed PR.

**Architecture:** The existing runners (`evals/runner*.ts`) already write `evals/results/<suite>-<timestamp>.json`. A new pure module `scripts/ci/eval-compare.ts` reads that file and `evals/baselines/<suite>.json`, applies the three rules, and exits non-zero on regression. A new workflow `evals-nightly.yml` runs the suites, the compare step, uploads artefacts, opens a rebaseline PR on request (PAT), and clones the E2E `notify-on-failure` job.

**Tech Stack:** `tsx`, Vitest, GitHub Actions, `actions/github-script@v7`, `gh` (in CI only), the Anthropic and OpenAI keys as repository secrets.

**Spec:** `docs/superpowers/specs/2026-09-14-advanced-testing-lanes-design.md` §Lane C, §Shared mechanism. Shared constraints: `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-00-index.md` §Global Constraints.

## Global Constraints

- Advisory lane. `evals-nightly.yml` is never a required check. Cron is added only in Task 5 (C1), after C0's dispatch runs are green.
- Pinned in the workflow env: `EVAL_JUDGE_MODEL: claude-sonnet-4-6`, `EVAL_SAMPLES_PER_CASE: "1"`, `EVAL_PARALLELISM: "4"`. `NODE_ENV` is not set (the runner refuses `production` without `--allow-prod`).
- Secrets are user-created: `ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `BASELINE_PR_TOKEN`. The plan never writes a secret.
- The five suites and their `suiteName` strings (the results-file prefix): `coach`, `recipe-chat`, `meal-suggestions`, `recipe-generation`, `photo-analysis`. `npm run eval:all` omits `eval:photo`; the workflow lists all five explicitly.
- `scripts/ci/eval-compare.ts` must not import `evals/lib/runner-core.ts` (it constructs an Anthropic client at import time via `judge-generic.ts:9`). Task 1 extracts the bootstrap into a side-effect-free module first.
- Overall regression rule uses a bootstrap over **per-case mean rubric score** (unweighted) computed by the compare script; the runner's `weightedOverall` is recorded for display only (dimension weights live in `SuiteConfig`, not in the results JSON). Safety's extra weight is enforced by rule 2, which applies only to suites that have a `safety` dimension (`coach`, `recipe-chat`).
- Commit messages: no backticks in `-m`; end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. In a `/todo` worktree use `/usr/bin/git`.
- **STOP after each completed task** (green + committed + reviewed): report and end the turn so the user can compact. See index §Execution protocol. Tasks 4–5 contain human-gated steps (secrets, dispatches, merges) — stop and ask at each.

## File structure

| File                                     | Responsibility                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `evals/lib/bootstrap.ts`                 | `mulberry32`, `bootstrapMeanCI`, constants — moved out of `runner-core.ts`, no imports            |
| `evals/lib/runner-core.ts`               | re-exports the two functions from `./bootstrap` (unchanged public surface)                        |
| `scripts/ci/eval-compare.ts`             | pure `perCaseMeans`, `toBaseline`, `compareSuite`, `renderSummary`; CLI                           |
| `scripts/__tests__/eval-compare.test.ts` | positive controls: each rule tripped by its own doctored run; matching run passes                 |
| `evals/baselines/<suite>.json` × 5       | committed baselines (produced only by the workflow's `rebaseline=true` path)                      |
| `.github/workflows/evals-nightly.yml`    | dispatch (Task 3) + cron (Task 5); run → compare → artefacts → summary; rebaseline PR; notify job |

---

### Task 1: Extract the bootstrap into a side-effect-free module

**Files:**

- Create: `evals/lib/bootstrap.ts`
- Modify: `evals/lib/runner-core.ts` (delete lines 48–90: `BOOTSTRAP_ITERATIONS`, `BOOTSTRAP_SEED`, `mulberry32`, `bootstrapMeanCI`; add the import + re-export)
- Test: `evals/__tests__/bootstrap.test.ts` (new); `evals/__tests__/runner-core.test.ts` (existing, must stay green)

**Interfaces:**

- Produces: `evals/lib/bootstrap.ts` exporting `BOOTSTRAP_ITERATIONS = 1000`, `BOOTSTRAP_SEED = 42`, `mulberry32(seed: number): () => number`, `bootstrapMeanCI(values: number[]): { mean: number; lower: number; upper: number }` — byte-identical bodies to the current `runner-core.ts:48-90`.
- `runner-core.ts` keeps exporting `mulberry32` and `bootstrapMeanCI` (re-export), so `evals/__tests__/runner-core.test.ts` is untouched.

- [x] **Step 1: Write the failing test**

```ts
// evals/__tests__/bootstrap.test.ts
import { describe, it, expect } from "vitest";
import { bootstrapMeanCI, mulberry32, BOOTSTRAP_SEED } from "../lib/bootstrap";

describe("bootstrap (side-effect-free module)", () => {
  it("is deterministic for a fixed input", () => {
    const values = [3, 4, 4, 5, 6, 7, 7, 8];
    expect(bootstrapMeanCI(values)).toEqual(bootstrapMeanCI(values));
  });

  it("brackets the sample mean", () => {
    const { mean, lower, upper } = bootstrapMeanCI([1, 2, 3, 4, 5]);
    expect(mean).toBe(3);
    expect(lower).toBeLessThanOrEqual(mean);
    expect(upper).toBeGreaterThanOrEqual(mean);
  });

  it("collapses degenerate inputs", () => {
    expect(bootstrapMeanCI([])).toEqual({ mean: 0, lower: 0, upper: 0 });
    expect(bootstrapMeanCI([7])).toEqual({ mean: 7, lower: 7, upper: 7 });
  });

  it("mulberry32 is a pure function of its seed", () => {
    const a = mulberry32(BOOTSTRAP_SEED);
    const b = mulberry32(BOOTSTRAP_SEED);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run evals/__tests__/bootstrap.test.ts`
Expected: FAIL — `Cannot find module '../lib/bootstrap'`

- [x] **Step 3: Create the module and re-export from runner-core**

```ts
// evals/lib/bootstrap.ts
/**
 * Seeded percentile bootstrap for eval score confidence intervals. Kept free
 * of imports so scripts/ci/eval-compare.ts can use it without pulling in
 * runner-core.ts (which constructs an Anthropic client at import time).
 * Moved verbatim from runner-core.ts on 2026-09-14.
 */
export const BOOTSTRAP_ITERATIONS = 1000;
export const BOOTSTRAP_SEED = 42;

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function (): number {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapMeanCI(values: number[]): {
  mean: number;
  lower: number;
  upper: number;
} {
  if (values.length === 0) return { mean: 0, lower: 0, upper: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, lower: mean, upper: mean };

  const rng = mulberry32(BOOTSTRAP_SEED);
  const means: number[] = [];
  for (let i = 0; i < BOOTSTRAP_ITERATIONS; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) {
      sum += values[Math.floor(rng() * values.length)];
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return {
    mean,
    lower: means[Math.floor(BOOTSTRAP_ITERATIONS * 0.025)],
    upper: means[Math.floor(BOOTSTRAP_ITERATIONS * 0.975)],
  };
}
```

In `evals/lib/runner-core.ts`, replace lines 48–90 with:

```ts
import { bootstrapMeanCI, mulberry32 } from "./bootstrap";
export { bootstrapMeanCI, mulberry32 };
```

(Keep this import with the others at the top of the file; `BOOTSTRAP_ITERATIONS`/`BOOTSTRAP_SEED` had no other users in `runner-core.ts` — confirm with `grep -n BOOTSTRAP_ evals/lib/runner-core.ts`, expected: no hits after the edit.)

- [x] **Step 4: Run both test files**

Run: `npx vitest run evals/__tests__/bootstrap.test.ts evals/__tests__/runner-core.test.ts`
Expected: PASS (runner-core's existing `bootstrapMeanCI`/`mulberry32` tests unchanged).

- [x] **Step 5: Commit**

```bash
git add evals/lib/bootstrap.ts evals/lib/runner-core.ts evals/__tests__/bootstrap.test.ts
git commit -m "refactor(evals): extract seeded bootstrap into an import-free module

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `eval-compare.ts` — three rules, baseline writer, CLI

**Files:**

- Create: `scripts/ci/eval-compare.ts`
- Test: `scripts/__tests__/eval-compare.test.ts`
- Modify: `package.json` (add script `"eval:compare": "npx tsx scripts/ci/eval-compare.ts"`)

**Interfaces:**

- Produces (exports of `scripts/ci/eval-compare.ts`):
  - `type RunLike = { runId: string; judgeModel: string; totalCases: number; assertionPassRate: number; weightedOverall: number; dimensionConfidenceIntervals: Record<string, { mean: number; lower: number; upper: number }>; cases: Array<{ rubricScores: Array<{ dimension: string; score: number }>; assertions: { passed: boolean } }> }` — the subset of `EvalRunResult` (`evals/types.ts:236`) the rules need.
  - `type EvalBaseline = { suite: string; generatedAt: string; sourceRunId: string; judgeModel: string; totalCases: number; assertionPassRate: number; weightedOverall: number; overall: { mean: number; lower: number; upper: number }; dimensions: Record<string, { mean: number; lower: number; upper: number }> }`.
  - `perCaseMeans(run: RunLike): number[]` — mean of `rubricScores[].score` per case; cases with no scores are skipped.
  - `toBaseline(run: RunLike, suite: string, generatedAt: string): EvalBaseline`.
  - `compareSuite(current: RunLike, baseline: EvalBaseline): { passed: boolean; failures: string[]; warnings: string[]; rows: Array<{ metric: string; current: number; baseline: number; bound: number }> }`.
  - `renderSummary(suite: string, result: ReturnType<typeof compareSuite>): string` — markdown.
  - CLI: `npx tsx scripts/ci/eval-compare.ts --suite <name> [--results-dir evals/results] [--results-file <path>] [--baseline-dir evals/baselines] [--write-baseline]`. Exit 0 pass / 1 regression / 2 no baseline (unless `--write-baseline`) / 3 no results file.

- [x] **Step 1: Write the failing test (one doctored run per rule, plus a matching run)**

```ts
// scripts/__tests__/eval-compare.test.ts
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
}): RunLike {
  const n = opts.safety.length;
  const passed = opts.assertionsPassed ?? Array(n).fill(true);
  const cases = opts.safety.map((s, i) => ({
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
    run.cases.push({ rubricScores: [], assertions: { passed: true } });
    expect(perCaseMeans(run)).toEqual([9, 6]);
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
});

function pick(run: RunLike): { safety: number[]; accuracy: number[] } {
  return {
    safety: run.cases.map((c) => c.rubricScores[0].score),
    accuracy: run.cases.map((c) => c.rubricScores[1].score),
  };
}
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/__tests__/eval-compare.test.ts`
Expected: FAIL — `Cannot find module '../ci/eval-compare'`

- [x] **Step 3: Write the module**

```ts
// scripts/ci/eval-compare.ts
/**
 * Nightly eval regression detection (Lane C). Reads the newest
 * evals/results/<suite>-*.json (written by evals/lib/runner-core.ts) and the
 * committed evals/baselines/<suite>.json, applies three rules, and exits
 * non-zero on regression. `--write-baseline` produces the baseline instead
 * (used only by the workflow's rebaseline=true path, which opens a PR).
 *
 * Rules (any one fails):
 *   overall:    bootstrap mean of per-case mean rubric score < baseline.overall.lower
 *   safety:     dimensionConfidenceIntervals.safety.mean < baseline.dimensions.safety.lower
 *               (only for suites whose baseline has a safety dimension)
 *   assertions: assertionPassRate < baseline.assertionPassRate (zero tolerance)
 *
 * Does NOT import evals/lib/runner-core.ts (Anthropic client at import time);
 * the bootstrap lives in evals/lib/bootstrap.ts.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { bootstrapMeanCI } from "../../evals/lib/bootstrap";

export interface Interval {
  mean: number;
  lower: number;
  upper: number;
}

export interface RunLike {
  runId: string;
  judgeModel: string;
  totalCases: number;
  assertionPassRate: number;
  weightedOverall: number;
  dimensionConfidenceIntervals: Record<string, Interval>;
  cases: Array<{
    rubricScores: Array<{ dimension: string; score: number }>;
    assertions: { passed: boolean };
  }>;
}

export interface EvalBaseline {
  suite: string;
  generatedAt: string;
  sourceRunId: string;
  judgeModel: string;
  totalCases: number;
  assertionPassRate: number;
  weightedOverall: number;
  overall: Interval;
  dimensions: Record<string, Interval>;
}

export function perCaseMeans(run: RunLike): number[] {
  const out: number[] = [];
  for (const c of run.cases) {
    if (c.rubricScores.length === 0) continue;
    out.push(
      c.rubricScores.reduce((a, s) => a + s.score, 0) / c.rubricScores.length,
    );
  }
  return out;
}

function stripSampleSize(i: Interval): Interval {
  return { mean: i.mean, lower: i.lower, upper: i.upper };
}

export function toBaseline(
  run: RunLike,
  suite: string,
  generatedAt: string,
): EvalBaseline {
  const dimensions: Record<string, Interval> = {};
  for (const [dim, ci] of Object.entries(run.dimensionConfidenceIntervals)) {
    dimensions[dim] = stripSampleSize(ci);
  }
  return {
    suite,
    generatedAt,
    sourceRunId: run.runId,
    judgeModel: run.judgeModel,
    totalCases: run.totalCases,
    assertionPassRate: run.assertionPassRate,
    weightedOverall: run.weightedOverall,
    overall: bootstrapMeanCI(perCaseMeans(run)),
    dimensions,
  };
}

const EPS = 1e-9;

export function compareSuite(current: RunLike, baseline: EvalBaseline) {
  const failures: string[] = [];
  const warnings: string[] = [];
  const rows: Array<{
    metric: string;
    current: number;
    baseline: number;
    bound: number;
  }> = [];

  const overall = bootstrapMeanCI(perCaseMeans(current));
  rows.push({
    metric: "overall (per-case mean)",
    current: overall.mean,
    baseline: baseline.overall.mean,
    bound: baseline.overall.lower,
  });
  if (overall.mean + EPS < baseline.overall.lower) {
    failures.push(
      `overall: mean ${overall.mean.toFixed(3)} is below the baseline lower bound ${baseline.overall.lower.toFixed(3)} (baseline mean ${baseline.overall.mean.toFixed(3)})`,
    );
  }

  const baseSafety = baseline.dimensions.safety;
  const curSafety = current.dimensionConfidenceIntervals.safety;
  if (baseSafety && curSafety) {
    rows.push({
      metric: "safety",
      current: curSafety.mean,
      baseline: baseSafety.mean,
      bound: baseSafety.lower,
    });
    if (curSafety.mean + EPS < baseSafety.lower) {
      failures.push(
        `safety: mean ${curSafety.mean.toFixed(3)} is below the baseline safety lower bound ${baseSafety.lower.toFixed(3)}`,
      );
    }
  }

  rows.push({
    metric: "assertion pass rate",
    current: current.assertionPassRate,
    baseline: baseline.assertionPassRate,
    bound: baseline.assertionPassRate,
  });
  if (current.assertionPassRate + EPS < baseline.assertionPassRate) {
    failures.push(
      `assertions: pass rate ${current.assertionPassRate.toFixed(3)} dropped below the baseline ${baseline.assertionPassRate.toFixed(3)}`,
    );
  }

  if (current.judgeModel !== baseline.judgeModel) {
    warnings.push(
      `judge model changed: baseline ${baseline.judgeModel}, current ${current.judgeModel} — rebaseline before trusting this comparison`,
    );
  }

  return { passed: failures.length === 0, failures, warnings, rows };
}

export function renderSummary(
  suite: string,
  result: ReturnType<typeof compareSuite>,
): string {
  const lines = [
    `### Evals: ${suite} — ${result.passed ? "✅ no regression" : "❌ REGRESSION"}`,
    "",
    "| Metric | Current | Baseline mean | Fail below |",
    "|---|---|---|---|",
    ...result.rows.map(
      (r) =>
        `| ${r.metric} | ${r.current.toFixed(3)} | ${r.baseline.toFixed(3)} | ${r.bound.toFixed(3)} |`,
    ),
  ];
  for (const f of result.failures) lines.push("", `- ❌ ${f}`);
  for (const w of result.warnings) lines.push("", `- ⚠️ ${w}`);
  return lines.join("\n") + "\n";
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function newestResultsFile(suite: string, dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${suite}-`) && f.endsWith(".json"))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

function main(): void {
  const suite = arg("--suite");
  if (!suite) {
    console.error(
      "usage: eval-compare --suite <name> [--results-dir d] [--results-file f] [--baseline-dir d] [--write-baseline]",
    );
    process.exit(2);
  }
  const resultsDir = arg("--results-dir") ?? "evals/results";
  const baselineDir = arg("--baseline-dir") ?? "evals/baselines";
  const resultsFile =
    arg("--results-file") ?? newestResultsFile(suite, resultsDir);
  if (!resultsFile || !fs.existsSync(resultsFile)) {
    console.error(`no results file for suite "${suite}" under ${resultsDir}`);
    process.exit(3);
  }
  const current = JSON.parse(fs.readFileSync(resultsFile, "utf8")) as RunLike;
  const baselinePath = path.join(baselineDir, `${suite}.json`);

  if (process.argv.includes("--write-baseline")) {
    fs.mkdirSync(baselineDir, { recursive: true });
    const baseline = toBaseline(current, suite, new Date().toISOString());
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`wrote ${baselinePath} from ${resultsFile}`);
    process.exit(0);
  }

  if (!fs.existsSync(baselinePath)) {
    console.error(
      `no baseline at ${baselinePath} — dispatch the workflow with rebaseline=true`,
    );
    process.exit(2);
  }
  const baseline = JSON.parse(
    fs.readFileSync(baselinePath, "utf8"),
  ) as EvalBaseline;
  const result = compareSuite(current, baseline);
  const summary = renderSummary(suite, result);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  process.exit(result.passed ? 0 : 1);
}

if (process.argv[1] && /eval-compare\.(ts|js)$/.test(process.argv[1])) {
  main();
}
```

Add to `package.json` scripts (next to the `eval:*` entries):

```json
"eval:compare": "npx tsx scripts/ci/eval-compare.ts",
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/eval-compare.test.ts`
Expected: PASS (8 tests). If "rule 2 … even when overall holds" fails on rule 1 also firing, the fixture's accuracy lift did not fully offset the safety drop for one case because of the ±2.5 symmetry — keep the drop and lift exactly equal per case (they are, by construction); do not widen any bound.

- [x] **Step 5: Commit**

```bash
git add scripts/ci/eval-compare.ts scripts/__tests__/eval-compare.test.ts package.json
git commit -m "ci(evals): eval-compare with overall/safety/assertion regression rules and baseline writer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `evals-nightly.yml` — dispatch only, run → compare → artefacts → rebaseline PR → notify

**Files:**

- Create: `.github/workflows/evals-nightly.yml`

**Interfaces:**

- Consumes: `npm run eval:<suite>` scripts (`package.json:63-67`), `npm run eval:compare` (Task 2), secrets `ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `BASELINE_PR_TOKEN`.
- Produces: artefact `eval-results-<run_id>` containing `evals/results/`; step summary per suite; on `rebaseline=true` a PR from branch `baselines/evals-<run_id>`; on regression an issue labelled `evals-regression-failure`.

- [x] **Step 1: Write the workflow**

```yaml
# .github/workflows/evals-nightly.yml
name: Evals nightly

# Advisory: NOT a required check. Runs the five LLM eval suites and compares
# each against evals/baselines/<suite>.json with three regression rules
# (scripts/ci/eval-compare.ts). A red run files/updates an Issue (see
# notify-on-failure) — it never blocks a merge. Baselines change only through
# the rebaseline=true dispatch below, which opens a PR for human review.
#
# Cron is intentionally absent until C1 (see the Lane C plan): C0 proves the
# job on workflow_dispatch first.

on:
  workflow_dispatch:
    inputs:
      suite:
        description: "Suite to run"
        required: true
        default: all
        type: choice
        options:
          [
            all,
            coach,
            recipe-chat,
            meal-suggestions,
            recipe-generation,
            photo-analysis,
          ]
      rebaseline:
        description: "Write fresh baselines and open a PR instead of comparing"
        required: true
        default: false
        type: boolean

concurrency:
  group: evals-nightly-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: read

env:
  # Pinned here, not in code: a default-model bump in evals/lib/judge-generic.ts
  # must not silently move the baseline.
  EVAL_JUDGE_MODEL: claude-sonnet-4-6
  EVAL_SAMPLES_PER_CASE: "1"
  EVAL_PARALLELISM: "4"
  LOG_LEVEL: silent
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  AI_INTEGRATIONS_OPENAI_API_KEY: ${{ secrets.AI_INTEGRATIONS_OPENAI_API_KEY }}
  # Stub the remaining external keys exactly as ci.yml does so a suite that
  # touches them never hits a real endpoint.
  USDA_API_KEY: stub
  API_NINJAS_KEY: stub

jobs:
  evals:
    name: Run and compare eval suites
    runs-on: ubuntu-latest
    outputs:
      regressed: ${{ steps.compare.outputs.regressed }}
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Resolve suite list
        id: suites
        run: |
          set -euo pipefail
          if [ "${{ inputs.suite }}" = "all" ]; then
            echo "list=coach recipe-chat meal-suggestions recipe-generation photo-analysis" >> "$GITHUB_OUTPUT"
          else
            echo "list=${{ inputs.suite }}" >> "$GITHUB_OUTPUT"
          fi

      # Each suite writes evals/results/<suite>-<timestamp>.json (runner-core.ts:544).
      # `eval:all` omits eval:photo, so the suites are invoked individually.
      - name: Run eval suites
        run: |
          set -euo pipefail
          declare -A SCRIPT=( [coach]=eval:coach [recipe-chat]=eval:recipe-chat [meal-suggestions]=eval:meal-suggestions [recipe-generation]=eval:recipe-generation [photo-analysis]=eval:photo )
          for s in ${{ steps.suites.outputs.list }}; do
            echo "::group::npm run ${SCRIPT[$s]}"
            npm run "${SCRIPT[$s]}"
            echo "::endgroup::"
          done

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v7
        with:
          name: eval-results-${{ github.run_id }}
          path: evals/results/
          if-no-files-found: error

      - name: Compare against baselines
        id: compare
        if: ${{ !inputs.rebaseline }}
        run: |
          set -uo pipefail
          regressed=false
          for s in ${{ steps.suites.outputs.list }}; do
            if ! npm run --silent eval:compare -- --suite "$s"; then
              regressed=true
            fi
          done
          echo "regressed=$regressed" >> "$GITHUB_OUTPUT"
          [ "$regressed" = "false" ]

      - name: Write baselines
        if: ${{ inputs.rebaseline }}
        run: |
          set -euo pipefail
          for s in ${{ steps.suites.outputs.list }}; do
            npm run --silent eval:compare -- --suite "$s" --write-baseline
          done
          git status --short evals/baselines/

      # PAT, not GITHUB_TOKEN: pushes/PRs made with GITHUB_TOKEN trigger no
      # other workflows, so the PR would carry no required checks and be
      # unmergeable under branch protection. BASELINE_PR_TOKEN is a fine-grained
      # PAT (contents + pull-requests write, this repo only), user-created.
      - name: Open rebaseline PR
        if: ${{ inputs.rebaseline }}
        env:
          GH_TOKEN: ${{ secrets.BASELINE_PR_TOKEN }}
        run: |
          set -euo pipefail
          branch="baselines/evals-${{ github.run_id }}"
          git config user.name "ocrecipes-baselines"
          git config user.email "baselines@users.noreply.github.com"
          git switch -c "$branch"
          git add evals/baselines/
          git commit -m "chore(baselines): refresh evals baselines $(date -u +%F) (run ${{ github.run_id }})" \
            -m "Suites: ${{ steps.suites.outputs.list }}. Judge: ${EVAL_JUDGE_MODEL}. Review the interval shifts before merging."
          git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/${{ github.repository }}.git"
          git push -u origin "$branch"
          gh pr create --base main --head "$branch" \
            --title "chore(baselines): refresh evals baselines $(date -u +%F)" \
            --body "Automated by evals-nightly rebaseline=true, run ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}. Only evals/baselines/*.json change. Compare the new intervals against the previous file before merging."

  notify-on-failure:
    name: Notify on eval regression
    needs: [evals]
    if: always() && needs.evals.result == 'failure' && !inputs.rebaseline
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - name: Open or update failure issue
        uses: actions/github-script@v7
        with:
          script: |
            const label = 'evals-regression-failure';
            const title = 'Evals: nightly regression detected';
            const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
            const body = [
              'The Evals nightly workflow detected a regression against the committed baselines.',
              '',
              `- Run: ${runUrl} (see the job summary for the per-suite table)`,
              '',
              'If the change is intentional (prompt improvement, model change), dispatch the workflow with rebaseline=true and review the resulting PR. Close this issue once the suite is green again.',
            ].join('\n');
            try {
              await github.rest.issues.getLabel({ owner: context.repo.owner, repo: context.repo.repo, name: label });
            } catch {
              await github.rest.issues.createLabel({ owner: context.repo.owner, repo: context.repo.repo, name: label, color: 'd73a4a' });
            }
            const { data: issues } = await github.rest.issues.listForRepo({
              owner: context.repo.owner, repo: context.repo.repo, state: 'open', labels: label,
            });
            const existing = issues.find((issue) => issue.title === title);
            if (existing) {
              await github.rest.issues.createComment({ owner: context.repo.owner, repo: context.repo.repo, issue_number: existing.number, body });
            } else {
              await github.rest.issues.create({ owner: context.repo.owner, repo: context.repo.repo, title, body, labels: [label] });
            }
```

- [x] **Step 2: Validate the YAML locally**

```bash
node -e 'const y=require("js-yaml"); y.load(require("fs").readFileSync(".github/workflows/evals-nightly.yml","utf8")); console.log("yaml ok")' 2>/dev/null || npx --yes yaml-lint .github/workflows/evals-nightly.yml
```

Expected: `yaml ok` (or the linter's success line).

- [x] **Step 3: Commit**

```bash
git add .github/workflows/evals-nightly.yml
git commit -m "ci(evals): nightly evals workflow (dispatch only) with compare, rebaseline PR, and failure issue

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: C0 verification — dry run, first baselines, PR-checks proof, spend

These steps produce evidence for the C0 PR body; none of them changes code except the baseline PR the workflow opens.

- [ ] **Step 1: Confirm the three secrets exist** (user-created). Do not create them yourself. If any is missing, stop and ask.

- [ ] **Step 2: Push the branch and dispatch a dry run on it**

Dispatch `Evals nightly` on the branch with `suite=coach`, `rebaseline=false`. Expected: the run step completes (`Full results saved to: evals/results/coach-…json` in the log) and the compare step exits 2 with `no baseline at evals/baselines/coach.json — dispatch the workflow with rebaseline=true`. This proves: no Postgres needed (the run step did not fail on `DATABASE_URL`), secrets are wired, results are written. If the run step fails on a missing `DATABASE_URL`, add the `postgres:16` service block from `.github/workflows/ci.yml:163-176` and the `DATABASE_URL`/`db:push` steps, and record why in the PR body.

> **Amended 2026-10-01 (Lane C ledger R5, R12):** Task 3 already adds the Postgres service (3 of 5 services throw at import without `DATABASE_URL`). Expected dry-run observation is now: the run step completes, the compare step fails with `::error::eval-compare for coach exited 2 (2 = no baseline, 3 = no results file)`, the job is red, and **no issue is filed** (notify fires on a dispatch only when `regressed=true`).

- [ ] **Step 3: Dispatch `suite=all`, `rebaseline=true`**

Expected: a PR titled `chore(baselines): refresh evals baselines <date>` from `baselines/evals-<run_id>` containing exactly five files under `evals/baselines/`. Open the PR's Checks tab: the required checks must be present and running — that proves `BASELINE_PR_TOKEN` (not `GITHUB_TOKEN`) made the push. If the Checks tab is empty, the PAT lacks scope or was not used; fix the secret, delete the branch, re-dispatch.

- [ ] **Step 4: Review and merge the baseline PR** per the merge policy (a human reads the five files; every `overall.lower ≤ overall.mean`).

- [ ] **Step 5: Dispatch `suite=all`, `rebaseline=false` against main**

Expected: compare passes for all five (green run, five summary tables).

- [ ] **Step 6: Record spend** from the Anthropic and OpenAI dashboards for the run in Step 5 (one full pass); write the figure in the C0 PR body as `Measured nightly spend: $X.XX (run <id>)`.

_(C0 ends here — Tasks 1–4. C1 is Task 5, after C0 and its baseline PR have merged.)_

---

### Task 5 (C1): Enable the cron; apply the small-suite sensitivity rule

**Files:**

- Modify: `.github/workflows/evals-nightly.yml` (add `schedule:`)
- Possibly modify: the same file's `Run eval suites` step (per-suite `EVAL_SAMPLES_PER_CASE=3`) and `evals/baselines/*.json` via a rebaseline PR

- [ ] **Step 1: Add the schedule** (off-hour minute, not the E2E nightly's `17 8`):

```yaml
on:
  schedule:
    # 09:41 UTC nightly — off-hour minute (scheduler congestion), an hour after
    # the E2E nightly so the two never contend for the same runner window.
    - cron: "41 9 * * *"
  workflow_dispatch:
    # (inputs unchanged)
```

For scheduled runs `inputs.suite` is empty — make the resolve step default to `all`:

```bash
suite="${{ inputs.suite }}"; suite="${suite:-all}"
if [ "$suite" = "all" ]; then … else echo "list=$suite" … fi
```

and guard the rebaseline conditions with `${{ inputs.rebaseline == true }}` (false on schedule).

> **Amended 2026-10-01 (Lane C final review, ai-reviewer):** the shipped Task 3 step reads the input through env (`SUITE: ${{ inputs.suite }}`, ruling R15), so apply the default there: `SUITE: ${{ inputs.suite || 'all' }}`, keeping inline `${{ }}` out of the script. Also make the resolve step FAIL when the resolved list is empty (`[ -n "$list" ] || { echo "::error::empty suite list"; exit 1; }`). Without that check, an empty list means the run and compare loops iterate over nothing and the job goes green having run no suite. Add a harness case: with `SUITE=""` the step must produce the full list, and with a forced empty list it must exit non-zero.

- [ ] **Step 2: Sensitivity check for the 12-case suites** (after five scheduled runs are green — run URLs go in the PR body)

For each of `photo-analysis` and `recipe-generation`: download the latest results artefact, copy the suite's results JSON, lower every case's lowest-dimension score by 1.0 in the copy (a `node -e` one-liner over `cases[].rubricScores`), and run:

```bash
npm run --silent eval:compare -- --suite photo-analysis --results-file /tmp/doctored-photo.json
```

Expected: exit 1 (regression detected). If it exits 0, the suite's bounds are too wide at one sample per case: in the workflow's `Run eval suites` step, export `EVAL_SAMPLES_PER_CASE=3` for that suite only (an `if [ "$s" = photo-analysis ]` branch around the `npm run`), dispatch `rebaseline=true` for that suite, and merge the resulting baseline PR. Record which suites needed it.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/evals-nightly.yml
git commit -m "ci(evals): enable the nightly schedule; per-suite sample count for low-sensitivity suites

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Verification (C0 PR)

```bash
npx vitest run evals/__tests__/bootstrap.test.ts evals/__tests__/runner-core.test.ts scripts/__tests__/eval-compare.test.ts
grep -n "import.*runner-core" scripts/ci/eval-compare.ts || echo "eval-compare does not import runner-core (correct)"
grep -n "cron" .github/workflows/evals-nightly.yml || echo "no cron yet (correct for C0)"
```

## Considered and rejected

- Importing `bootstrapMeanCI` straight from `runner-core.ts` — its import graph constructs `new Anthropic()` at load (`judge-generic.ts:9`), which throws without a key; the extraction in Task 1 is the smallest fix.
- Using the runner's `weightedOverall` for rule 1 — it is a scalar with no interval; the weights are not in the results JSON. Per-case means + the shared bootstrap give a principled bound; rule 2 carries the safety weighting.
- Comparing against the previous run's artefact instead of a committed baseline — silent drift; after one bad night every later night is "green" against a wrong reference.
