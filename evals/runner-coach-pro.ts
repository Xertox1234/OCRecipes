import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { formatContextSummary } from "./judge";
import { coachProShownReply } from "./lib/coach-shown-reply";
import { runCoachProChecks } from "./lib/coach-pro-checks";
import {
  casesForRun,
  coachProCasesSchema,
  type CoachProCase,
} from "./lib/coach-pro-cases";
import { COACH_DIMENSION_WEIGHTS, COACH_RUBRIC_TEXT } from "./lib/coach-rubric";
import { runEvalSuite } from "./lib/runner-core";
import { ALL_DIMENSIONS } from "./types";
import type { EvalTestCase } from "./types";
import type { CoachContext } from "../server/services/coach-prompt";
import { isRecipeFinderEnabled } from "../server/services/recipe-finder/config";

/**
 * Coach Pro eval runner (audit 2026-11-24, M30): tools, write cards, the
 * blocks prompt, memory, mood and multi-turn history, on a fixed clock and
 * with no database. Deterministic checks (tools, arguments, blocks, cards)
 * gate before the judge score. Run: npm run eval:coach-pro
 */

const DEFAULT_NOW = "2026-11-18T17:30:00Z";
const DEFAULT_TZ = "America/Toronto";

const datasetPath = path.join(__dirname, "datasets", "coach-pro-cases.json");
const parsed = coachProCasesSchema.safeParse(
  JSON.parse(fs.readFileSync(datasetPath, "utf8")),
);
if (!parsed.success) {
  console.error("Error: coach-pro-cases.json failed schema validation:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const only = process.env.EVAL_CASES?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const allCases = parsed.data;
const cases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;
if (only && cases.length !== only.length) {
  const unknown = only.filter((id) => !allCases.some((c) => c.id === id));
  console.error(
    `Error: EVAL_CASES names unknown case(s): ${unknown.join(", ")}`,
  );
  process.exit(1);
}

const clockOf = (c: CoachProCase) => ({
  now: new Date(c.now ?? DEFAULT_NOW),
  tz: c.tz ?? DEFAULT_TZ,
});
const asPro = (t: EvalTestCase) => t as unknown as CoachProCase;

// The finder flag changes the tool list (search_recipes is retired when it is
// on, and offer_recipe exists only then), so the run states which it used
// and names the offer cases it could not run.
const { run, skipped } = casesForRun(cases, {
  finderOn: isRecipeFinderEnabled(),
});
console.log(
  `Coach Pro eval: ${run.length} case(s); RECIPE_FINDER_ENABLED=${isRecipeFinderEnabled()}`,
);
if (skipped.length > 0) {
  console.log(
    `Skipped (need RECIPE_FINDER_ENABLED=true): ${skipped.join(", ")}`,
  );
}

runEvalSuite(
  run.map((c) => ({
    ...c,
    // A server-written safety reply fails every case that does not expect one.
    assertions: {
      ...c.assertions,
      cannedSafetyReply: c.assertions?.cannedSafetyReply ?? "forbidden",
    },
  })) as unknown as EvalTestCase[],
  {
    suiteName: "coach-pro",
    rubricText: COACH_RUBRIC_TEXT,
    dimensions: ALL_DIMENSIONS,
    dimensionWeights: COACH_DIMENSION_WEIGHTS,
    inputTag: "user_context",
    outputTag: "coach_response",

    generateResponse: async (testCase) => {
      const c = asPro(testCase);
      const start = Date.now();
      const reply = await coachProShownReply({
        history: c.history,
        message: c.userMessage,
        context: c.context as CoachContext,
        clock: clockOf(c),
        flags: c.flags,
        fixtures: c.fixtures,
      });
      return {
        text: reply.text,
        structuredData: {
          toolCalls: reply.toolCalls,
          blockTypes: reply.blockTypes,
          proposals: reply.proposals,
          offer: reply.offer,
          flags: c.flags,
        },
        latencyMs: Date.now() - start,
        wordCount: reply.text.split(/\s+/).filter(Boolean).length,
        noModelCall: !reply.modelCalled,
      };
    },

    extraAssertions: (testCase, data) =>
      runCoachProChecks(
        data as Parameters<typeof runCoachProChecks>[0],
        asPro(testCase).pro,
      ),

    formatInput: (testCase) => {
      const c = asPro(testCase);
      const history = c.history.length
        ? `Earlier turns:\n${c.history.map((h) => `- ${h.role}: ${h.content}`).join("\n")}\n\n`
        : "";
      const fixtures = Object.keys(c.fixtures).length
        ? `\n\nTool data the coach could look up (JSON): ${JSON.stringify(c.fixtures)}`
        : "";
      return `${history}User message: ${c.userMessage}\n\n${formatContextSummary(c.context as CoachContext, clockOf(c))}${fixtures}\n\nCoach Pro, app features on: ${JSON.stringify(c.flags)}`;
    },
  },
).catch((err) => {
  console.error(err);
  process.exit(1);
});
