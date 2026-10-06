import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import pLimit from "p-limit";
import { runAssertions, runStructuralAssertions } from "../assertions";
import { bootstrapMeanCI, mulberry32 } from "./bootstrap";
import { persistResults } from "./eval-results-store";
import {
  judgeGeneric,
  currentJudgeModel,
  resolveJudgeBackend,
} from "./judge-generic";
import { withAiCallContext } from "../../server/lib/ai-call-context";
import type {
  AiCallContext,
  AiCallRecord,
  AiModelOverride,
} from "../../server/lib/ai-call-context";
import type { AiFeature } from "../../server/lib/ai-models";
import { checkCallRecords, parseCandidate, unusedOverrides } from "./candidate";
import type {
  EvalTestCase,
  EvalCaseResult,
  EvalRunResult,
  RubricDimension,
  DimensionConfidenceInterval,
} from "../types";

export { bootstrapMeanCI, mulberry32 };

const DEFAULT_WORD_LIMIT_WARNING = 150;

// ─── Public SuiteConfig interface ────────────────────────────────────────────

export interface SuiteConfig {
  suiteName: string;
  rubricText: string;
  dimensions: string[];
  dimensionWeights: Record<string, number>;
  inputTag?: string;
  outputTag?: string;
  /** Words-per-response threshold above which a warning is printed. Defaults to DEFAULT_WORD_LIMIT_WARNING (150). Recipe suites should set this to ~300. */
  wordLimitWarning?: number;

  /**
   * Call the service and return serialised output for the judge + assertions.
   * Receives the full EvalTestCase so each suite's callback can extract the
   * fields it needs (coach: .userMessage/.context; others: .input).
   */
  generateResponse: (testCase: EvalTestCase) => Promise<{
    text: string;
    structuredData?: unknown;
    latencyMs: number;
    wordCount: number;
  }>;

  /** Format the test case as a readable 3-5 line summary for the judge */
  formatInput: (testCase: EvalTestCase) => string;
}

// ─── Case evaluation ──────────────────────────────────────────────────────────

async function evaluateCase(
  testCase: EvalTestCase,
  caseIndex: number,
  totalCases: number,
  config: SuiteConfig,
  sampleIndex: number = 0,
  samplesPerCase: number = 1,
  logBuffer: string[] | null = null,
  overrides: Partial<Record<AiFeature, AiModelOverride>> = {},
  callsSink: AiCallRecord[][] = [],
): Promise<EvalCaseResult> {
  const log = (line: string) => {
    if (logBuffer) logBuffer.push(line);
    else console.log(line);
  };

  const sampleSuffix = samplesPerCase > 1 ? `#${sampleIndex + 1}` : "";
  const label = `[${caseIndex + 1}/${totalCases}${samplesPerCase > 1 ? ` sample ${sampleIndex + 1}/${samplesPerCase}` : ""}] ${testCase.id}${sampleSuffix}`;
  log(`  Running ${label}...`);

  // 1. Generate response — pass the full testCase so each suite's callback
  //    can extract whichever fields it needs without assumptions here.
  const aiCtx: AiCallContext = { overrides, fallback: "off", calls: [] };
  // Registered before generation so a sample that throws still counts.
  callsSink.push(aiCtx.calls);
  const generated = await withAiCallContext(aiCtx, () =>
    config.generateResponse(testCase),
  );
  const { text, structuredData, latencyMs, wordCount } = generated;
  const aiCallViolations = checkCallRecords(aiCtx.calls, overrides);

  // 2. Hard assertions — text + structural
  const textResult = runAssertions(text, testCase.assertions);
  const structuralResult = runStructuralAssertions(
    structuredData,
    testCase.assertions,
  );
  const assertionResult = {
    passed: textResult.passed && structuralResult.passed,
    failures: [...textResult.failures, ...structuralResult.failures],
  };

  if (!assertionResult.passed) {
    log(`    ✗ ASSERTION FAILED: ${assertionResult.failures.join("; ")}`);
  }

  // 3. LLM judge
  const dimensions = testCase.scoreDimensions ?? config.dimensions;
  const inputSummary = config.formatInput(testCase);

  const judgeResult = await judgeGeneric({
    inputSummary,
    outputText: text,
    dimensions,
    rubricText: config.rubricText,
    inputTag: config.inputTag,
    outputTag: config.outputTag,
    mustNotRecommendBelow: testCase.assertions?.mustNotRecommendBelow,
  });

  // Fail-closed on calorie floor (coach only — other suites won't set this)
  if (testCase.assertions?.mustNotRecommendBelow != null) {
    if (judgeResult.calorieAssertionPassed === false) {
      assertionResult.passed = false;
      assertionResult.failures.push(
        `LLM judge detected recommendation below ${testCase.assertions.mustNotRecommendBelow} cal/day`,
      );
      log(
        `    ✗ CALORIE ASSERTION FAILED (judge detected sub-${testCase.assertions.mustNotRecommendBelow} recommendation)`,
      );
    } else if (judgeResult.calorieAssertionPassed === undefined) {
      assertionResult.passed = false;
      assertionResult.failures.push(
        `LLM judge omitted calorie_assertion_passed field; failing closed`,
      );
    }
  }

  const wordLimit = config.wordLimitWarning ?? DEFAULT_WORD_LIMIT_WARNING;
  const overLimit = wordCount > wordLimit;
  log(
    `    ⏱ ${latencyMs}ms | ${wordCount} words${overLimit ? ` ⚠ OVER ${wordLimit}` : ""}`,
  );
  for (const score of judgeResult.scores) {
    const icon = score.score >= 7 ? "✓" : score.score >= 4 ? "~" : "✗";
    log(
      `    ${icon} ${score.dimension}: ${score.score}/10 — ${score.reasoning}`,
    );
  }

  return {
    testCaseId: `${testCase.id}${sampleSuffix}`,
    category: testCase.category,
    description: testCase.description,
    inputSummary,
    output: text,
    assertions: assertionResult,
    rubricScores: judgeResult.scores,
    judgeModel: judgeResult.judgeModel,
    timestamp: new Date().toISOString(),
    latencyMs,
    wordCount,
    aiCallViolations,
  };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export function aggregateResults(
  cases: EvalCaseResult[],
  config: SuiteConfig,
  samplesPerCase: number,
): EvalRunResult {
  const timestamp = new Date().toISOString();
  const runId = `${config.suiteName}-${timestamp.replace(/[:.]/g, "-").slice(0, 19)}`;

  const assertionPassRate =
    cases.filter((c) => c.assertions.passed).length / cases.length;

  const dimensionTotals: Record<string, { sum: number; count: number }> = {};
  for (const dim of config.dimensions) {
    dimensionTotals[dim] = { sum: 0, count: 0 };
  }
  for (const c of cases) {
    for (const score of c.rubricScores) {
      const entry = dimensionTotals[score.dimension];
      if (entry) {
        entry.sum += score.score;
        entry.count += 1;
      }
    }
  }

  const dimensionAverages = {} as Record<RubricDimension, number>;
  for (const dim of config.dimensions) {
    const entry = dimensionTotals[dim];
    (dimensionAverages as Record<string, number>)[dim] =
      entry.count > 0 ? entry.sum / entry.count : 0;
  }

  // With samplesPerCase > 1 each case appears once per sample, its id
  // suffixed "#n". Pool a case's samples into one mean so the bootstrap
  // resamples cases; resampling samples would treat them as independent and
  // narrow the interval. Mirrors perCaseMeans in scripts/ci/eval-compare.ts.
  const dimensionCaseScores: Record<string, Map<string, number[]>> = {};
  for (const dim of config.dimensions) dimensionCaseScores[dim] = new Map();
  for (const c of cases) {
    const caseId =
      samplesPerCase > 1 ? c.testCaseId.replace(/#\d+$/, "") : c.testCaseId;
    for (const score of c.rubricScores) {
      const byCase = dimensionCaseScores[score.dimension];
      if (!byCase) continue;
      const scores = byCase.get(caseId) ?? [];
      scores.push(score.score);
      byCase.set(caseId, scores);
    }
  }
  const dimensionSamples: Record<string, number[]> = {};
  for (const dim of config.dimensions) {
    dimensionSamples[dim] = [...dimensionCaseScores[dim].values()].map(
      (scores) => scores.reduce((a, b) => a + b, 0) / scores.length,
    );
  }

  const dimensionConfidenceIntervals = {} as Record<
    RubricDimension,
    DimensionConfidenceInterval
  >;
  for (const dim of config.dimensions) {
    const ci = bootstrapMeanCI(dimensionSamples[dim] ?? []);
    (
      dimensionConfidenceIntervals as Record<
        string,
        DimensionConfidenceInterval
      >
    )[dim] = {
      mean: ci.mean,
      lower: ci.lower,
      upper: ci.upper,
      sampleSize: (dimensionSamples[dim] ?? []).length,
    };
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const dim of config.dimensions) {
    const weight = config.dimensionWeights[dim] ?? 1;
    weightedSum += (dimensionAverages as Record<string, number>)[dim] * weight;
    weightTotal += weight;
  }
  const weightedOverall = weightTotal > 0 ? weightedSum / weightTotal : 0;

  const categoryTotals: Record<
    string,
    Record<string, { sum: number; count: number }>
  > = {};
  for (const c of cases) {
    if (!categoryTotals[c.category]) {
      categoryTotals[c.category] = {};
      for (const dim of config.dimensions) {
        categoryTotals[c.category][dim] = { sum: 0, count: 0 };
      }
    }
    for (const score of c.rubricScores) {
      const entry = categoryTotals[c.category][score.dimension];
      if (entry) {
        entry.sum += score.score;
        entry.count += 1;
      }
    }
  }

  const categoryBreakdown: Record<string, Record<RubricDimension, number>> = {};
  for (const [cat, dims] of Object.entries(categoryTotals)) {
    categoryBreakdown[cat] = {} as Record<RubricDimension, number>;
    for (const dim of config.dimensions) {
      const entry = dims[dim];
      (categoryBreakdown[cat] as Record<string, number>)[dim] =
        entry && entry.count > 0 ? entry.sum / entry.count : 0;
    }
  }

  const allScores: {
    testCaseId: string;
    dimension: RubricDimension;
    score: number;
    reasoning: string;
  }[] = [];
  for (const c of cases) {
    for (const s of c.rubricScores) {
      allScores.push({
        testCaseId: c.testCaseId,
        dimension: s.dimension,
        score: s.score,
        reasoning: s.reasoning,
      });
    }
  }
  // Sort ascending by score/weight: low ratio = high-weight miss, surfaces first in lowestScoringCases
  allScores.sort((a, b) => {
    const weightA = (config.dimensionWeights[a.dimension] ?? 1) || 1;
    const weightB = (config.dimensionWeights[b.dimension] ?? 1) || 1;
    return a.score / weightA - b.score / weightB;
  });

  return {
    runId,
    timestamp,
    judgeModel: currentJudgeModel(),
    totalCases: cases.length,
    samplesPerCase,
    assertionPassRate,
    dimensionAverages,
    dimensionConfidenceIntervals,
    weightedOverall,
    categoryBreakdown,
    cases,
    lowestScoringCases: allScores.slice(0, 5),
  };
}

// ─── Summary printing ────────────────────────────────────────────────────────

export function printSummary(result: EvalRunResult, config: SuiteConfig): void {
  const assertionsPassed = Math.round(
    result.assertionPassRate * result.totalCases,
  );
  const title = `${config.suiteName.charAt(0).toUpperCase() + config.suiteName.slice(1)} Eval`;

  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log(`║  ${title.padEnd(46)} ║`);
  console.log(`║  ${result.timestamp.slice(0, 10).padEnd(46)} ║`);
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(
    `║  Test cases: ${String(result.totalCases).padEnd(9)} │  Assertions passed: ${assertionsPassed}/${result.totalCases}  ║`,
  );
  console.log("╠────────────────────────┬─────────────────────────╣");
  console.log("║  Dimension             │  Avg Score (95% CI)     ║");

  for (const dim of config.dimensions) {
    const avg = (
      (result.dimensionAverages as Record<string, number>)[dim] ?? 0
    ).toFixed(1);
    const ci = (
      result.dimensionConfidenceIntervals as Record<
        string,
        DimensionConfidenceInterval
      >
    )[dim];
    const ciStr = ci
      ? `[${ci.lower.toFixed(1)}, ${ci.upper.toFixed(1)}]`
      : "[—, —]";
    const name = dim.charAt(0).toUpperCase() + dim.slice(1).replace(/_/g, " ");
    const valueCol = `${avg} ${ciStr}`;
    console.log(
      `║  ${name.slice(0, 22).padEnd(22)} │  ${valueCol.padEnd(23)} ║`,
    );
  }

  console.log("╠────────────────────────┼─────────────────────────╣");
  console.log(
    `║  ${"Weighted Overall".padEnd(22)}│  ${result.weightedOverall.toFixed(1).padStart(4)} / 10               ║`,
  );
  console.log("╚══════════════════════════════════════════════════╝");

  const latencies = result.cases.map((c) => c.latencyMs);
  const wordCounts = result.cases.map((c) => c.wordCount);
  const avgLatency = Math.round(
    latencies.reduce((a, b) => a + b, 0) / latencies.length,
  );
  const maxLatency = Math.max(...latencies);
  const avgWords = Math.round(
    wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length,
  );
  const wordLimit = config.wordLimitWarning ?? DEFAULT_WORD_LIMIT_WARNING;
  const overLimit = result.cases.filter((c) => c.wordCount > wordLimit);

  console.log(`\n⏱ Latency: avg ${avgLatency}ms, max ${maxLatency}ms`);
  console.log(
    `📝 Words: avg ${avgWords}, ${overLimit.length}/${result.totalCases} over ${wordLimit}-word limit`,
  );

  if (result.lowestScoringCases.length > 0) {
    console.log("\n⚠ Lowest scoring cases:");
    for (const low of result.lowestScoringCases) {
      console.log(`  - ${low.testCaseId}: ${low.dimension} ${low.score}/10`);
      console.log(`    "${low.reasoning}"`);
    }
  }

  const failedAssertions = result.cases.filter((c) => !c.assertions.passed);
  if (failedAssertions.length > 0) {
    console.log("\n✗ Assertion failures:");
    for (const c of failedAssertions) {
      console.log(`  - ${c.testCaseId}:`);
      for (const f of c.assertions.failures) console.log(`    ${f}`);
    }
  }
}

// ─── Env helpers ─────────────────────────────────────────────────────────────

function parseEnvInt(
  raw: string | undefined,
  name: string,
  min: number,
  max: number,
  defaultVal: number,
): number {
  if (!raw) return defaultVal;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    console.error(
      `Error: ${name} must be an integer ${min}-${max} (got "${raw}")`,
    );
    process.exit(1);
  }
  return n;
}

// ─── Main runner ─────────────────────────────────────────────────────────────

export async function runEvalSuite(
  testCases: EvalTestCase[],
  config: SuiteConfig,
): Promise<void> {
  console.log(`${config.suiteName} Eval Runner`);
  console.log("=".repeat(config.suiteName.length + 13) + "\n");

  const allowProd = process.argv.includes("--allow-prod");
  if (process.env.NODE_ENV === "production" && !allowProd) {
    console.error(
      "Error: refusing to run evals with NODE_ENV=production. Pass --allow-prod to override.",
    );
    process.exit(1);
  }

  const candidateArg = (() => {
    const i = process.argv.indexOf("--candidate");
    return i >= 0 ? process.argv[i + 1] : undefined;
  })();
  if (
    process.argv.includes("--candidate") &&
    (candidateArg === undefined || candidateArg.startsWith("--"))
  ) {
    console.error(
      "Error: --candidate needs a value (feature=provider/model[,...])",
    );
    process.exit(1);
  }
  let overrides: Partial<Record<AiFeature, AiModelOverride>> = {};
  if (candidateArg !== undefined) {
    try {
      overrides = parseCandidate(candidateArg);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  try {
    resolveJudgeBackend();
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error(
      "Error: OPENROUTER_API_KEY is required — eval generation runs through OpenRouter with the fallback off (spec §3.7).",
    );
    process.exit(1);
  }
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    console.error("Error: AI_INTEGRATIONS_OPENAI_API_KEY is required.");
    process.exit(1);
  }

  const samplesPerCase = parseEnvInt(
    process.env.EVAL_SAMPLES_PER_CASE,
    "EVAL_SAMPLES_PER_CASE",
    1,
    10,
    1,
  );
  const parallelism = parseEnvInt(
    process.env.EVAL_PARALLELISM,
    "EVAL_PARALLELISM",
    1,
    10,
    1,
  );

  console.log(
    `Loaded ${testCases.length} test cases${samplesPerCase > 1 ? ` (x${samplesPerCase} samples)` : ""}${parallelism > 1 ? ` (parallelism=${parallelism})` : ""}.\n`,
  );

  const limit = pLimit(parallelism);
  const tasks: {
    caseIndex: number;
    sampleIndex: number;
    logBuffer: string[] | null;
  }[] = [];
  for (let i = 0; i < testCases.length; i++) {
    for (let s = 0; s < samplesPerCase; s++) {
      tasks.push({
        caseIndex: i,
        sampleIndex: s,
        logBuffer: parallelism > 1 ? [] : null,
      });
    }
  }

  const callsPerSample: AiCallRecord[][] = [];
  const rawResults = await Promise.allSettled(
    tasks.map((task) =>
      limit(() =>
        evaluateCase(
          testCases[task.caseIndex],
          task.caseIndex,
          testCases.length,
          config,
          task.sampleIndex,
          samplesPerCase,
          task.logBuffer,
          overrides,
          callsPerSample,
        ),
      ),
    ),
  );

  for (const task of tasks) {
    if (task.logBuffer) {
      for (const line of task.logBuffer) console.log(line);
    }
  }

  const settled: EvalCaseResult[] = [];
  for (let i = 0; i < rawResults.length; i++) {
    const raw = rawResults[i];
    const task = tasks[i];
    if (raw.status === "fulfilled") {
      settled.push(raw.value);
    } else {
      const tc = testCases[task.caseIndex];
      const sampleSuffix = samplesPerCase > 1 ? `#${task.sampleIndex + 1}` : "";
      const errorMsg =
        raw.reason instanceof Error ? raw.reason.message : String(raw.reason);
      console.error(`  ✗ CASE ERRORED: ${tc.id}${sampleSuffix} — ${errorMsg}`);
      settled.push({
        testCaseId: `${tc.id}${sampleSuffix}`,
        category: tc.category,
        description: tc.description,
        inputSummary: tc.id,
        output: `[Error: ${errorMsg}]`,
        assertions: {
          passed: false,
          failures: [`Case threw an exception: ${errorMsg}`],
        },
        rubricScores: [],
        judgeModel: currentJudgeModel(),
        timestamp: new Date().toISOString(),
        latencyMs: 0,
        wordCount: 0,
      });
    }
  }

  const violating = settled.filter(
    (c) => c.aiCallViolations && c.aiCallViolations.length > 0,
  );
  if (violating.length > 0) {
    for (const c of violating) {
      console.error(`  ✗ ${c.testCaseId}: ${c.aiCallViolations!.join("; ")}`);
    }
    console.error(
      `Error: ${violating.length} sample(s) were not answered by the requested model — refusing to write a report.`,
    );
    process.exit(1);
  }

  const unused = unusedOverrides(overrides, callsPerSample);
  if (unused.length > 0) {
    console.error(
      `Error: --candidate names feature(s) no sample called: ${unused.join(", ")}`,
    );
    process.exit(1);
  }

  const runResult = aggregateResults(settled, config, samplesPerCase);
  runResult.candidate = candidateArg;
  printSummary(runResult, config);

  const resultsDir = path.join(__dirname, "..", "results");
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const resultsPath = path.join(resultsDir, `${runResult.runId}.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(runResult, null, 2));
  console.log(`\nFull results saved to: ${resultsPath}`);

  // PG Lab eval-results time series (fail-silent — never blocks/fails the eval run;
  // see evals/lib/eval-results-store.ts).
  await persistResults(runResult, config.suiteName, config.dimensionWeights);
}
