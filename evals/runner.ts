import "dotenv/config"; // Load .env before any service imports read process.env
import * as fs from "fs";
import * as path from "path";
import { generateCoachResponse } from "../server/services/nutrition-coach";
import { runAssertions } from "./assertions";
import { judgeResponse, formatContextSummary } from "./judge";
import type {
  EvalTestCase,
  EvalCaseResult,
  EvalRunResult,
  RubricDimension,
} from "./types";
import { ALL_DIMENSIONS } from "./types";

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
): Promise<EvalCaseResult> {
  const label = `[${caseIndex + 1}/${totalCases}] ${testCase.id}`;
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

  // If judge detected calorie violation, add to assertion failures
  if (
    testCase.assertions?.mustNotRecommendBelow != null &&
    judgeResult.calorieAssertionPassed === false
  ) {
    assertionResult.passed = false;
    assertionResult.failures.push(
      `LLM judge detected recommendation below ${testCase.assertions.mustNotRecommendBelow} cal/day`,
    );
    console.log(
      `    ✗ CALORIE ASSERTION FAILED (judge detected sub-${testCase.assertions.mustNotRecommendBelow} recommendation)`,
    );
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
    testCaseId: testCase.id,
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

function aggregateResults(cases: EvalCaseResult[]): EvalRunResult {
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
    totalCases: cases.length,
    assertionPassRate,
    dimensionAverages,
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
  console.log("╠──────────────────┬───────────────────────────────╣");
  console.log("║  Dimension       │  Avg Score                    ║");

  for (const dim of ALL_DIMENSIONS) {
    const avg = result.dimensionAverages[dim].toFixed(1);
    const name = dim.charAt(0).toUpperCase() + dim.slice(1);
    console.log(
      `║  ${name.padEnd(16)} │  ${avg.padStart(4)} / 10                     ║`,
    );
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

  // Load test cases
  const datasetPath = path.join(__dirname, "datasets", "coach-cases.json");
  const raw = fs.readFileSync(datasetPath, "utf8");
  const testCases: EvalTestCase[] = JSON.parse(raw);

  console.log(`Loaded ${testCases.length} test cases.\n`);

  // Run evaluations sequentially
  const results: EvalCaseResult[] = [];
  for (let i = 0; i < testCases.length; i++) {
    const result = await evaluateCase(testCases[i], i, testCases.length);
    results.push(result);
  }

  // Aggregate and display
  const runResult = aggregateResults(results);
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
