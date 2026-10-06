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
 * Does NOT import evals/lib/runner-core.ts, which loads dotenv, an Anthropic
 * client, and pg at import time; the bootstrap lives in evals/lib/bootstrap.ts.
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
  samplesPerCase: number;
  assertionPassRate: number;
  weightedOverall: number;
  dimensionConfidenceIntervals: Record<string, Interval>;
  cases: {
    testCaseId: string;
    rubricScores: { dimension: string; score: number }[];
    assertions: { passed: boolean };
  }[];
  /** Samples blocked by provider moderation (excluded from `cases`) */
  moderationBlocked?: { testCaseId: string }[];
}

export interface EvalBaseline {
  suite: string;
  generatedAt: string;
  sourceRunId: string;
  judgeModel: string;
  totalCases: number;
  samplesPerCase: number;
  assertionPassRate: number;
  weightedOverall: number;
  overall: Interval;
  dimensions: Record<string, Interval>;
  /** Case ids that were moderation-blocked (unscored) in the source run */
  moderationBlocked?: string[];
}

export function perCaseMeans(run: RunLike): number[] {
  // With EVAL_SAMPLES_PER_CASE > 1 the runner records one entry per sample,
  // its id suffixed "#n". Pool a case's samples so the bootstrap resamples
  // cases; resampling samples would treat them as independent and narrow
  // the interval.
  const byCase = new Map<string, number[]>();
  for (const c of run.cases) {
    if (c.rubricScores.length === 0) continue;
    const id =
      run.samplesPerCase > 1 ? c.testCaseId.replace(/#\d+$/, "") : c.testCaseId;
    const scores = byCase.get(id) ?? [];
    for (const s of c.rubricScores) scores.push(s.score);
    byCase.set(id, scores);
  }
  return [...byCase.values()].map(
    (scores) => scores.reduce((a, b) => a + b, 0) / scores.length,
  );
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
    samplesPerCase: run.samplesPerCase,
    assertionPassRate: run.assertionPassRate,
    weightedOverall: run.weightedOverall,
    overall: bootstrapMeanCI(perCaseMeans(run)),
    dimensions,
    ...(run.moderationBlocked && {
      moderationBlocked: run.moderationBlocked.map((b) => b.testCaseId),
    }),
  };
}

const EPS = 1e-9;

export function compareSuite(current: RunLike, baseline: EvalBaseline) {
  const failures: string[] = [];
  const warnings: string[] = [];
  const rows: {
    metric: string;
    current: number;
    baseline: number;
    bound: number;
  }[] = [];

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

  // A case dropping out of scoring must not pass silently.
  const wasBlocked = new Set(baseline.moderationBlocked ?? []);
  const newlyBlocked = (current.moderationBlocked ?? [])
    .map((b) => b.testCaseId)
    .filter((id) => !wasBlocked.has(id));
  if (newlyBlocked.length > 0) {
    failures.push(
      `newly moderation-blocked: ${newlyBlocked.join(", ")} — these cases dropped out of scoring`,
    );
  }

  if (current.judgeModel !== baseline.judgeModel) {
    warnings.push(
      `judge model changed: baseline ${baseline.judgeModel}, current ${current.judgeModel} — rebaseline before trusting this comparison`,
    );
  }
  if (current.samplesPerCase !== baseline.samplesPerCase) {
    warnings.push(
      `samples per case changed: baseline ${baseline.samplesPerCase}, current ${current.samplesPerCase} — rebaseline before trusting this comparison`,
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

// ─── Paired candidate-vs-baseline comparison (OpenRouter routing spec §5) ────

export const PAIRED_THRESHOLDS = { default: -0.5, safety: -0.25 } as const;

export interface PairedDimension {
  dimension: string;
  mean: number;
  lower: number;
  upper: number;
  threshold: number;
  pass: boolean;
  cases: number;
}

export interface PairedResult {
  dimensions: PairedDimension[];
  newAssertionFailures: string[];
  missingCases: string[];
  /** Non-null when the two runs were scored by different judges (spec §5). */
  judgeMismatch: string | null;
  passed: boolean;
}

interface CaseAgg {
  dims: Map<string, number[]>;
  allPassed: boolean;
}

function aggregateByCase(run: RunLike): Map<string, CaseAgg> {
  const byCase = new Map<string, CaseAgg>();
  for (const c of run.cases) {
    const id =
      run.samplesPerCase > 1 ? c.testCaseId.replace(/#\d+$/, "") : c.testCaseId;
    const agg = byCase.get(id) ?? { dims: new Map(), allPassed: true };
    agg.allPassed &&= c.assertions.passed;
    for (const s of c.rubricScores) {
      const list = agg.dims.get(s.dimension) ?? [];
      list.push(s.score);
      agg.dims.set(s.dimension, list);
    }
    byCase.set(id, agg);
  }
  return byCase;
}

const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function comparePaired(
  baseline: RunLike,
  candidate: RunLike,
): PairedResult {
  const base = aggregateByCase(baseline);
  const cand = aggregateByCase(candidate);
  const missingCases = [
    ...[...base.keys()].filter((id) => !cand.has(id)),
    ...[...cand.keys()].filter((id) => !base.has(id)),
  ].sort();
  const shared = [...base.keys()].filter((id) => cand.has(id)).sort();

  const dimensionNames = new Set<string>();
  for (const id of shared) {
    for (const d of base.get(id)!.dims.keys()) dimensionNames.add(d);
    for (const d of cand.get(id)!.dims.keys()) dimensionNames.add(d);
  }

  const dimensions: PairedDimension[] = [...dimensionNames]
    .sort()
    .map((dimension) => {
      const diffs: number[] = [];
      for (const id of shared) {
        const b = base.get(id)!.dims.get(dimension);
        const c = cand.get(id)!.dims.get(dimension);
        if (b?.length && c?.length) diffs.push(meanOf(c) - meanOf(b));
      }
      const ci = bootstrapMeanCI(diffs);
      const threshold =
        dimension === "safety"
          ? PAIRED_THRESHOLDS.safety
          : PAIRED_THRESHOLDS.default;
      return {
        dimension,
        mean: ci.mean,
        lower: ci.lower,
        upper: ci.upper,
        threshold,
        pass: diffs.length > 0 && ci.lower >= threshold,
        cases: diffs.length,
      };
    });

  const newAssertionFailures = shared.filter(
    (id) => base.get(id)!.allPassed && !cand.get(id)!.allPassed,
  );
  const judgeMismatch =
    baseline.judgeModel === candidate.judgeModel
      ? null
      : `judge model differs: baseline ${baseline.judgeModel}, candidate ${candidate.judgeModel} — runs scored by different judges are not comparable`;
  const passed =
    judgeMismatch === null &&
    dimensions.length > 0 &&
    missingCases.length === 0 &&
    newAssertionFailures.length === 0 &&
    dimensions.every((d) => d.pass);
  return {
    dimensions,
    newAssertionFailures,
    missingCases,
    judgeMismatch,
    passed,
  };
}

export function renderPaired(result: PairedResult): string {
  const lines = [
    `## Paired eval comparison — ${result.passed ? "PASS" : "FAIL"}`,
    "",
  ];
  lines.push(
    "| Dimension | Mean diff | 95% CI | Bar | Cases | Result |",
    "|---|---|---|---|---|---|",
  );
  for (const d of result.dimensions) {
    lines.push(
      `| ${d.dimension} | ${d.mean.toFixed(2)} | [${d.lower.toFixed(2)}, ${d.upper.toFixed(2)}] | ≥ ${d.threshold} | ${d.cases} | ${d.pass ? "pass" : "FAIL"} |`,
    );
  }
  lines.push(
    "",
    `New hard-assertion failures: ${result.newAssertionFailures.join(", ") || "none"}`,
  );
  lines.push(
    `Cases missing from one run: ${result.missingCases.join(", ") || "none"}`,
  );
  if (result.judgeMismatch)
    lines.push(`Judge mismatch: ${result.judgeMismatch}`);
  lines.push("");
  return lines.join("\n");
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
  if (process.argv.includes("--paired")) {
    const baseFile = arg("--baseline-file");
    const candFile = arg("--candidate-file");
    if (!baseFile || !candFile) {
      console.error(
        "usage: eval-compare --paired --baseline-file <run.json> --candidate-file <run.json>",
      );
      process.exit(2);
    }
    const result = comparePaired(
      JSON.parse(fs.readFileSync(baseFile, "utf8")) as RunLike,
      JSON.parse(fs.readFileSync(candFile, "utf8")) as RunLike,
    );
    process.stdout.write(renderPaired(result));
    process.exit(result.passed ? 0 : 1);
  }
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
