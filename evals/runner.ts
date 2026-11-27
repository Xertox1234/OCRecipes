import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { formatContextSummary } from "./judge";
import { coachShownReply } from "./lib/coach-shown-reply";
import { runEvalSuite } from "./lib/runner-core";
import { COACH_DIMENSION_WEIGHTS, COACH_RUBRIC_TEXT } from "./lib/coach-rubric";
import { ALL_DIMENSIONS, evalTestCasesSchema } from "./types";
import type { EvalTestCase } from "./types";
import type { CoachContext } from "../server/services/coach-prompt";

/**
 * Every case runs on a fixed clock so a time-of-day answer (dinner ideas,
 * "it's already 6pm") is judged against the same time the prompt stated.
 * Wednesday 2026-11-18, 12:30 PM in Toronto, unless the case sets its own.
 */
const DEFAULT_NOW = "2026-11-18T17:30:00Z";
const DEFAULT_TZ = "America/Toronto";

function caseClock(testCase: EvalTestCase): { now: Date; tz: string } {
  return {
    now: new Date(testCase.now ?? DEFAULT_NOW),
    tz: testCase.tz ?? DEFAULT_TZ,
  };
}

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
  for (const issue of validation.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}
// A server-written safety reply fails every case that does not expect one.
const allCases: EvalTestCase[] = validation.data.map((c) => ({
  ...c,
  assertions: {
    ...c.assertions,
    cannedSafetyReply: c.assertions?.cannedSafetyReply ?? "forbidden",
  },
}));

// EVAL_CASES=id1,id2 runs only those cases (a cheap re-check of one change).
const only = process.env.EVAL_CASES?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const testCases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;
if (only) {
  const unknown = only.filter((id) => !allCases.some((c) => c.id === id));
  if (unknown.length > 0 || testCases.length === 0) {
    console.error(
      `Error: EVAL_CASES names unknown case(s): ${unknown.join(", ")}`,
    );
    process.exit(1);
  }
}

runEvalSuite(testCases, {
  suiteName: "coach",
  rubricText: COACH_RUBRIC_TEXT,
  dimensions: ALL_DIMENSIONS,
  dimensionWeights: COACH_DIMENSION_WEIGHTS,
  inputTag: "user_context",
  outputTag: "coach_response",

  generateResponse: async (testCase: EvalTestCase) => {
    const start = Date.now();
    const { text, modelCalled } = await coachShownReply(
      testCase.userMessage ?? "",
      testCase.context as CoachContext,
      caseClock(testCase),
    );
    const latencyMs = Date.now() - start;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return { text, latencyMs, wordCount, noModelCall: !modelCalled };
  },

  formatInput: (testCase: EvalTestCase) => {
    return `User message: ${testCase.userMessage ?? ""}\n\n${formatContextSummary(testCase.context as CoachContext, caseClock(testCase))}`;
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
