import "dotenv/config"; // Load .env before any service imports read process.env
import * as fs from "fs";
import * as path from "path";
import { generateCoachResponse } from "../server/services/nutrition-coach";
import { runAssertions } from "./assertions";
import {
  judgeResponse,
  formatContextSummary,
  DEFAULT_JUDGE_MODEL,
} from "./judge";
import type {
  EvalTestCase,
  EvalCaseResult,
  EvalRunResult,
  RubricDimension,
  DimensionConfidenceInterval,
} from "./types";
import { ALL_DIMENSIONS, evalTestCasesSchema } from "./types";

// Weight multipliers for the overall score
const DIMENSION_WEIGHTS: Record<RubricDimension, number> = {
  safety: 2,
  accuracy: 1,
  helpfulness: 1,
  personalization: 1,
  tone: 1,
};

async function collectStreamedResponse(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  context: Parameters<typeof generateCoachResponse>[1],
): Promise<string> {
  let full = "";
  for await (const chunk of generateCoachResponse(messages, context)) {
    full += chunk;
  }
  return full;
}

async function evaluateCase(
  testCase: EvalTestCase,
  caseIndex: number,
  totalCases: number,
  sampleIndex: number = 0,
  samplesPerCase: number = 1,
): Promise<EvalCaseResult> {
  const sampleSuffix = samplesPerCase > 1 ? `#${sampleIndex + 1}` : "";
  const label = `[${caseIndex + 1}/${totalCases}${samplesPerCase > 1 ? ` sample ${sampleIndex + 1}/${samplesPerCase}` : ""}] ${testCase.id}${sampleSuffix}`;
  console.log(`  Running ${label}...`);

  // 1. Generate coach response (with latency tracking)
  const messages: { role: "user" | "assistant" | "system"; content: string }[] =
    [{ role: "user", content: testCase.userMessage }];

  const startTime = Date.now();
  const coachResponse = await collectStreamedResponse(
    messages,
    testCase.context,
  );
  const latencyMs = Date.now() - startTime;
  const wordCount = coachResponse.split(/\s+/).filter(Boolean).length;

  // 2. Run hard assertions
  const assertionResult = runAssertions(coachResponse, testCase.assertions);

  if (!assertionResult.passed) {
    console.log(
      `    ✗ ASSERTION FAILED: ${assertionResult.failures.join("; ")}`,
    );
  }

  // 3. Send to LLM judge
  const dimensions = testCase.scoreDimensions ?? ALL_DIMENSIONS;
  const contextSummary = formatContextSummary(testCase.context);

  const judgeResult = await judgeResponse({
    userMessage: testCase.userMessage,
    contextSummary,
    coachResponse,
    dimensions,
    mustNotRecommendBelow: testCase.assertions?.mustNotRecommendBelow,
  });

  // Fail-close: if mustNotRecommendBelow was set, the judge MUST return
  // calorie_assertion_passed. A missing field means the judge did not
  // evaluate the floor — treat as assertion FAILED (conservative default
  // for safety-critical checks), not as a silent pass.
  if (testCase.assertions?.mustNotRecommendBelow != null) {
    if (judgeResult.calorieAssertionPassed === false) {
      assertionResult.passed = false;
      assertionResult.failures.push(
        `LLM judge detected recommendation below ${testCase.assertions.mustNotRecommendBelow} cal/day`,
      );
      console.log(
        `    ✗ CALORIE ASSERTION FAILED (judge detected sub-${testCase.assertions.mustNotRecommendBelow} recommendation)`,
      );
    } else if (judgeResult.calorieAssertionPassed === undefined) {
      assertionResult.passed = false;
      assertionResult.failures.push(
        `LLM judge omitted calorie_assertion_passed field (mustNotRecommendBelow=${testCase.assertions.mustNotRecommendBelow}); failing closed`,
      );
      console.log(
        `    ✗ CALORIE ASSERTION FAILED (judge omitted calorie_assertion_passed; failing closed for safety)`,
      );
    }
  }

  // Log scores and observability
  const overLimit = wordCount > 150;
  console.log(
    `    ⏱ ${latencyMs}ms | ${wordCount} words${overLimit ? " ⚠ OVER 150" : ""}`,
  );
  for (const score of judgeResult.scores) {
    const icon = score.score >= 7 ? "✓" : score.score >= 4 ? "~" : "✗";
    console.log(
      `    ${icon} ${score.dimension}: ${score.score}/10 — ${score.reasoning}`,
    );
  }

  return {
    testCaseId: `${testCase.id}${sampleSuffix}`,
    category: testCase.category,
    description: testCase.description,
    userMessage: testCase.userMessage,
    coachResponse,
    assertions: assertionResult,
    rubricScores: judgeResult.scores,
    timestamp: new Date().toISOString(),
    latencyMs,
    wordCount,
  };
}

/**
 * Seeded PRNG (mulberry32) for reproducible bootstrap resampling. Using a
 * fixed seed keeps CIs stable across runs of the same eval data, so a shift
 * in the CI is a real signal, not resampling noise.
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function (): number {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const BOOTSTRAP_ITERATIONS = 1000;
const BOOTSTRAP_SEED = 42;

/**
 * 95% percentile bootstrap CI for the mean of a sample.
 * Returns mean + [lower, upper] bounds. For n < 2 we widen the interval to
 * [min, max] of the observed values (CIs aren't meaningful for n=1 but the
 * field is non-optional, so use a conservative placeholder).
 */
function bootstrapMeanCI(values: number[]): {
  mean: number;
  lower: number;
  upper: number;
} {
  if (values.length === 0) {
    return { mean: 0, lower: 0, upper: 0 };
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) {
    return { mean, lower: mean, upper: mean };
  }

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
  const lower = means[Math.floor(BOOTSTRAP_ITERATIONS * 0.025)];
  const upper = means[Math.floor(BOOTSTRAP_ITERATIONS * 0.975)];
  return { mean, lower, upper };
}

function aggregateResults(
  cases: EvalCaseResult[],
  judgeModel: string,
  samplesPerCase: number,
): EvalRunResult {
  const timestamp = new Date().toISOString();
  const runId = timestamp.replace(/[:.]/g, "-").slice(0, 19);

  // Assertion pass rate
  const assertionsPassed = cases.filter((c) => c.assertions.passed).length;
  const assertionPassRate = assertionsPassed / cases.length;

  // Per-dimension averages
  const dimensionTotals: Record<string, { sum: number; count: number }> = {};
  for (const dim of ALL_DIMENSIONS) {
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
  for (const dim of ALL_DIMENSIONS) {
    const entry = dimensionTotals[dim];
    dimensionAverages[dim] = entry.count > 0 ? entry.sum / entry.count : 0;
  }

  // Bootstrapped 95% CIs per dimension over all individual case samples.
  // When samplesPerCase > 1 the pool includes repeated evaluations of the
  // same case, so the CI captures both cross-case variance and judge noise.
  const dimensionSamples: Record<RubricDimension, number[]> = {
    safety: [],
    accuracy: [],
    helpfulness: [],
    personalization: [],
    tone: [],
  };
  for (const c of cases) {
    for (const score of c.rubricScores) {
      dimensionSamples[score.dimension].push(score.score);
    }
  }
  const dimensionConfidenceIntervals = {} as Record<
    RubricDimension,
    DimensionConfidenceInterval
  >;
  for (const dim of ALL_DIMENSIONS) {
    const ci = bootstrapMeanCI(dimensionSamples[dim]);
    dimensionConfidenceIntervals[dim] = {
      mean: ci.mean,
      lower: ci.lower,
      upper: ci.upper,
      sampleSize: dimensionSamples[dim].length,
    };
  }

  // Weighted overall
  let weightedSum = 0;
  let weightTotal = 0;
  for (const dim of ALL_DIMENSIONS) {
    const weight = DIMENSION_WEIGHTS[dim];
    weightedSum += dimensionAverages[dim] * weight;
    weightTotal += weight;
  }
  const weightedOverall = weightTotal > 0 ? weightedSum / weightTotal : 0;

  // Per-category breakdown
  const categoryBreakdown: Record<string, Record<RubricDimension, number>> = {};
  const categoryTotals: Record<
    string,
    Record<string, { sum: number; count: number }>
  > = {};

  for (const c of cases) {
    if (!categoryTotals[c.category]) {
      categoryTotals[c.category] = {};
      for (const dim of ALL_DIMENSIONS) {
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

  for (const [cat, dims] of Object.entries(categoryTotals)) {
    categoryBreakdown[cat] = {} as Record<RubricDimension, number>;
    for (const dim of ALL_DIMENSIONS) {
      const entry = dims[dim];
      (categoryBreakdown[cat] as Record<string, number>)[dim] =
        entry.count > 0 ? entry.sum / entry.count : 0;
    }
  }

  // Lowest scoring cases (bottom 5)
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
  allScores.sort((a, b) => a.score - b.score);
  const lowestScoringCases = allScores.slice(0, 5);

  return {
    runId,
    timestamp,
    judgeModel,
    totalCases: cases.length,
    samplesPerCase,
    assertionPassRate,
    dimensionAverages,
    dimensionConfidenceIntervals,
    weightedOverall,
    categoryBreakdown,
    cases,
    lowestScoringCases,
  };
}

function printSummary(result: EvalRunResult): void {
  const assertionsPassed = Math.round(
    result.assertionPassRate * result.totalCases,
  );

  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log(
    `║  Nutrition Coach Evaluation  —  ${result.timestamp.slice(0, 10)}       ║`,
  );
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(
    `║  Test cases: ${String(result.totalCases).padEnd(3)} │  Assertions passed: ${assertionsPassed}/${result.totalCases}     ║`,
  );
  if (result.samplesPerCase > 1) {
    console.log(
      `║  Samples per case: ${String(result.samplesPerCase).padEnd(29)} ║`,
    );
  }
  console.log("╠──────────────────┬───────────────────────────────╣");
  console.log("║  Dimension       │  Avg Score (95% CI)           ║");

  for (const dim of ALL_DIMENSIONS) {
    const avg = result.dimensionAverages[dim].toFixed(1);
    const ci = result.dimensionConfidenceIntervals[dim];
    const ciStr = `[${ci.lower.toFixed(1)}, ${ci.upper.toFixed(1)}]`;
    const name = dim.charAt(0).toUpperCase() + dim.slice(1);
    const valueCol = `${avg} ${ciStr}`;
    console.log(`║  ${name.padEnd(16)} │  ${valueCol.padEnd(29)} ║`);
  }

  console.log("╠──────────────────┼───────────────────────────────╣");
  console.log(
    `║  Weighted Overall│  ${result.weightedOverall.toFixed(1).padStart(4)} / 10                     ║`,
  );
  console.log("╚══════════════════════════════════════════════════╝");

  // Observability stats
  const latencies = result.cases.map((c) => c.latencyMs);
  const wordCounts = result.cases.map((c) => c.wordCount);
  const avgLatency = Math.round(
    latencies.reduce((a, b) => a + b, 0) / latencies.length,
  );
  const maxLatency = Math.max(...latencies);
  const avgWords = Math.round(
    wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length,
  );
  const overLimit = result.cases.filter((c) => c.wordCount > 150);

  console.log("");
  console.log(`⏱ Latency: avg ${avgLatency}ms, max ${maxLatency}ms`);
  console.log(
    `📝 Words: avg ${avgWords}, ${overLimit.length}/${result.totalCases} over 150-word limit`,
  );
  if (overLimit.length > 0) {
    for (const c of overLimit) {
      console.log(`   - ${c.testCaseId}: ${c.wordCount} words`);
    }
  }

  if (result.lowestScoringCases.length > 0) {
    console.log("");
    console.log("⚠ Lowest scoring cases:");
    for (const low of result.lowestScoringCases) {
      console.log(`  - ${low.testCaseId}: ${low.dimension} ${low.score}/10`);
      console.log(`    "${low.reasoning}"`);
    }
  }

  // Assertion failures
  const failedAssertions = result.cases.filter((c) => !c.assertions.passed);
  if (failedAssertions.length > 0) {
    console.log("");
    console.log("✗ Assertion failures:");
    for (const c of failedAssertions) {
      console.log(`  - ${c.testCaseId}:`);
      for (const f of c.assertions.failures) {
        console.log(`    ${f}`);
      }
    }
  }
}

async function main(): Promise<void> {
  console.log("Nutrition Coach Evaluation Runner");
  console.log("=================================\n");

  // M14: prevent accidental production runs. Real Anthropic + OpenAI API
  // calls from prod environment could pollute analytics, burn budget, or
  // leak test payloads into live logs. Require `--allow-prod` for the rare
  // case of running evals against a production-pointed .env.
  const allowProd = process.argv.includes("--allow-prod");
  if (process.env.NODE_ENV === "production" && !allowProd) {
    console.error("Error: refusing to run evals with NODE_ENV=production.");
    console.error(
      "Evals hit real AI APIs — running against production keys can pollute",
    );
    console.error(
      "analytics and burn budget. Pass --allow-prod to override explicitly.",
    );
    process.exit(1);
  }

  // Verify environment
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required.");
    console.error("Set it in your .env file or export it before running.");
    process.exit(1);
  }

  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    console.error(
      "Error: AI_INTEGRATIONS_OPENAI_API_KEY environment variable is required (for the coach).",
    );
    process.exit(1);
  }

  // M12: optional per-case sampling with bootstrap CIs. Default 1 preserves
  // current behavior; set EVAL_SAMPLES_PER_CASE=3 to run each case 3x and
  // pool results for tighter confidence intervals on dimension means.
  const samplesPerCase = (() => {
    const raw = process.env.EVAL_SAMPLES_PER_CASE;
    if (raw == null || raw === "") return 1;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      console.error(
        `Error: EVAL_SAMPLES_PER_CASE must be an integer 1-10 (got "${raw}")`,
      );
      process.exit(1);
    }
    return n;
  })();

  // L23: Zod-validate the dataset at load time so bad test-case data fails
  // the run with a clear error instead of silently producing garbage scores.
  const datasetPath = path.join(__dirname, "datasets", "coach-cases.json");
  const raw = fs.readFileSync(datasetPath, "utf8");
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: coach-cases.json is not valid JSON: ${message}`);
    process.exit(1);
  }

  const validation = evalTestCasesSchema.safeParse(parsedJson);
  if (!validation.success) {
    console.error("Error: coach-cases.json failed schema validation:");
    for (const issue of validation.error.errors) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  const testCases: EvalTestCase[] = validation.data;

  console.log(
    `Loaded ${testCases.length} test cases${samplesPerCase > 1 ? ` (x${samplesPerCase} samples each = ${testCases.length * samplesPerCase} evaluations)` : ""}.\n`,
  );

  // Run evaluations sequentially. When samplesPerCase > 1 each case runs
  // N times and every sample becomes its own EvalCaseResult in the pool,
  // so the aggregator naturally computes averages + CIs across samples.
  const results: EvalCaseResult[] = [];
  for (let i = 0; i < testCases.length; i++) {
    for (let s = 0; s < samplesPerCase; s++) {
      const result = await evaluateCase(
        testCases[i],
        i,
        testCases.length,
        s,
        samplesPerCase,
      );
      results.push(result);
    }
  }

  // Aggregate and display
  const runResult = aggregateResults(
    results,
    DEFAULT_JUDGE_MODEL,
    samplesPerCase,
  );
  printSummary(runResult);

  // Save results
  const resultsDir = path.join(__dirname, "results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const resultsPath = path.join(resultsDir, `${runResult.runId}.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(runResult, null, 2));
  console.log(`\nFull results saved to: ${resultsPath}`);
}

main().catch((err) => {
  console.error("Evaluation failed:", err);
  process.exit(1);
});
