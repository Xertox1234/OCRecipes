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
  assertionPassRate: number;
  weightedOverall: number;
  dimensionConfidenceIntervals: Record<string, Interval>;
  cases: {
    rubricScores: { dimension: string; score: number }[];
    assertions: { passed: boolean };
  }[];
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
