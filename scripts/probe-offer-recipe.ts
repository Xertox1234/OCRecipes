/**
 * Probe: does the production Coach Pro model call `offer_recipe` at the right
 * times? (spec 2026-10-06-coach-recipe-offer-design §4/§7 measurement gate.)
 *
 * Mirrors generateCoachProResponse: same system prompt builder (Pro tier, with
 * the offer rule replacing the finder rule), same tool list minus
 * search_recipes plus OFFER_RECIPE_TOOL, same message sanitising, same
 * feature ("coach-pro-chat" → OpenRouter), same temperature/max tokens —
 * non-streaming. Run: NODE_ENV=development npx tsx scripts/probe-offer-recipe.ts
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  AiCallContext,
  AiCallRecord,
} from "../server/lib/ai-call-context";
import type { TurnClassFallback } from "../server/services/recipe-finder/classify-turn";

export type ProbeSet = "ask" | "recipe_negative" | "coach_negative";

export interface ProbeRun {
  id: string;
  set: ProbeSet;
  called: boolean;
  reachedToolLoop: boolean;
  /** The call (or the classifier) failed; says nothing about the model. */
  errored?: boolean;
}

export interface SetScore {
  majority: number;
  total: number;
}

export interface ProbeReport {
  ask: SetScore;
  recipe_negative: SetScore;
  coach_negative: SetScore;
  /** Errored runs per set (429/timeout/classifier failure). */
  errored: Record<ProbeSet, number>;
  /** Cases with fewer than 2 non-errored runs; any makes the run fail. */
  inconclusive: number;
  pass: boolean;
}

const SETS: ProbeSet[] = ["ask", "recipe_negative", "coach_negative"];

/** Per case: majority = at least 2 of 3 runs that reached the loop AND called. */
export function scoreProbe(runs: ProbeRun[]): ProbeReport {
  const byCase = new Map<string, ProbeRun[]>();
  for (const r of runs) {
    const list = byCase.get(r.id) ?? [];
    list.push(r);
    byCase.set(r.id, list);
  }
  const score: Record<ProbeSet, SetScore> = {
    ask: { majority: 0, total: 0 },
    recipe_negative: { majority: 0, total: 0 },
    coach_negative: { majority: 0, total: 0 },
  };
  const errored: Record<ProbeSet, number> = {
    ask: 0,
    recipe_negative: 0,
    coach_negative: 0,
  };
  let inconclusive = 0;
  for (const caseRuns of byCase.values()) {
    const set = caseRuns[0].set;
    score[set].total += 1;
    errored[set] += caseRuns.filter((r) => r.errored).length;
    if (caseRuns.filter((r) => !r.errored).length < 2) inconclusive += 1;
    const hits = caseRuns.filter(
      (r) => !r.errored && r.called && r.reachedToolLoop,
    ).length;
    if (hits >= 2) score[set].majority += 1;
  }
  return {
    ...score,
    errored,
    inconclusive,
    pass:
      inconclusive === 0 &&
      score.ask.majority >= 8 &&
      score.recipe_negative.majority === 0 &&
      score.coach_negative.majority <= 1,
  };
}

/**
 * Why classifyTurn's answer is not a measurement, or null when it is. With
 * the fallback off, aiChat records a failed call's error on the context
 * (ai-call-context.ts AiCallRecord.error); a call that never answered has no
 * answeredModel. A call that answered can still be unusable: classifyTurn
 * swallows bad JSON and returns "new_request", which `fallback` exposes.
 */
export function classifierFailure(
  calls: Pick<AiCallRecord, "error" | "answeredModel">[],
  fallback: TurnClassFallback,
): string | null {
  if (calls.length === 0 || calls.some((r) => r.error || !r.answeredModel)) {
    return "CLASSIFIER FAILED";
  }
  if (fallback) return `CLASSIFIER FAILED: ${fallback} reply`;
  return null;
}

interface ProbeCase {
  id: string;
  set: ProbeSet;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  routedByClassifyTurn?: boolean;
  currentRecipeTitle?: string;
}

const RUNS_PER_CASE = 3;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    console.error("Error: refusing to run the probe with NODE_ENV=production.");
    process.exit(1);
  }
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("Error: OPENROUTER_API_KEY is required.");
    process.exit(1);
  }

  // Imported after the guards so a refused run never loads the server graph.
  const { aiChat } = await import("../server/lib/ai-client");
  const { withAiCallContext } = await import("../server/lib/ai-call-context");
  const { buildSystemPrompt } = await import(
    "../server/services/nutrition-coach"
  );
  const { classifyIntent } = await import(
    "../server/services/coach-intent-classifier"
  );
  const { getBlocksSystemPrompt } = await import(
    "../server/services/coach-blocks"
  );
  const { TOOL_DEFINITIONS } = await import(
    "../server/services/nutrition-coach"
  );
  const { classifyTurnDetailed } = await import(
    "../server/services/recipe-finder/classify-turn"
  );
  const { OFFER_RECIPE_TOOL } = await import(
    "../server/services/recipe-finder/offer"
  );
  const { sanitizeUserInput, sanitizeContextField } = await import(
    "../server/lib/ai-safety"
  );

  const cases = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "evals",
        "datasets",
        "coach-offer-recipe.json",
      ),
      "utf8",
    ),
  ) as ProbeCase[];

  const tools = [
    ...TOOL_DEFINITIONS.filter(
      (t) => !("function" in t && t.function.name === "search_recipes"),
    ),
    OFFER_RECIPE_TOOL,
  ];

  const context = {
    goals: { calories: 2000, protein: 120, carbs: 220, fat: 65 },
    todayIntake: { calories: 800, protein: 50, carbs: 90, fat: 25 },
    dietaryProfile: { dietType: null, allergies: [], dislikes: [] },
    blocksPrompt: getBlocksSystemPrompt(true, { offer: true }),
  };

  const runs: ProbeRun[] = [];
  const settings: string[] = [];

  for (const c of cases) {
    let reachedToolLoop = true;
    if (c.routedByClassifyTurn) {
      const clsCtx: AiCallContext = {
        overrides: {},
        fallback: "off",
        calls: [],
      };
      const { class: cls, fallback } = await withAiCallContext(clsCtx, () =>
        classifyTurnDetailed(c.message, c.currentRecipeTitle ?? ""),
      );
      // A fallback "new_request" is not a measurement (see classifierFailure).
      const failure = classifierFailure(clsCtx.calls, fallback);
      console.log(
        `  classifyTurn(${c.id}) → ${cls}${failure ? ` (${failure})` : ""}`,
      );
      if (failure) {
        for (let i = 0; i < RUNS_PER_CASE; i++) {
          runs.push({
            id: c.id,
            set: c.set,
            called: false,
            reachedToolLoop: false,
            errored: true,
          });
        }
        continue;
      }
      reachedToolLoop = cls === "new_request" || cls === "other";
    }
    if (!reachedToolLoop) {
      for (let i = 0; i < RUNS_PER_CASE; i++) {
        runs.push({ id: c.id, set: c.set, called: false, reachedToolLoop });
      }
      continue;
    }

    const intent = classifyIntent(c.message, { recipeRequests: false }).intent;
    const systemPrompt = buildSystemPrompt(context, intent, {
      tz: "UTC",
      tier: "pro",
    });
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...c.history.map((m) => ({
        role: m.role,
        content:
          m.role === "user"
            ? sanitizeUserInput(m.content)
            : sanitizeContextField(m.content),
      })),
      { role: "user", content: sanitizeUserInput(c.message) },
    ];

    const results = await Promise.all(
      Array.from({ length: RUNS_PER_CASE }, async () => {
        const aiCtx: AiCallContext = {
          overrides: {},
          fallback: "off",
          calls: [],
        };
        try {
          const res = await withAiCallContext(aiCtx, () =>
            aiChat("coach-pro-chat", {
              messages,
              tools,
              max_completion_tokens: 1500,
              temperature: 0.5,
            }),
          );
          settings.push(String(res.model));
          const calls = res.choices[0]?.message?.tool_calls ?? [];
          return {
            called: calls.some(
              (t) =>
                t.type === "function" && t.function.name === "offer_recipe",
            ),
            errored: false,
          };
        } catch (err) {
          console.error(
            `  ! ${c.id}: call failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return { called: false, errored: true };
        }
      }),
    );
    for (const r of results) {
      runs.push({
        id: c.id,
        set: c.set,
        called: r.called,
        reachedToolLoop,
        errored: r.errored,
      });
    }
    console.log(
      `  ${c.id} [${c.set}] intent=${intent} called=${results.map((r) => (r.errored ? "E" : r.called ? "Y" : "n")).join("")}`,
    );
  }

  const report = scoreProbe(runs);
  console.log(`\nModel(s) that answered: ${[...new Set(settings)].join(", ")}`);
  for (const set of SETS) {
    console.log(
      `\n## ${set}: ${report[set].majority}/${report[set].total} (errored runs: ${report.errored[set]})`,
    );
    const ids = [
      ...new Set(runs.filter((r) => r.set === set).map((r) => r.id)),
    ];
    for (const id of ids) {
      const cr = runs.filter((r) => r.id === id);
      const cell = cr
        .map((r) =>
          r.errored ? "E" : !r.reachedToolLoop ? "-" : r.called ? "Y" : "n",
        )
        .join("");
      console.log(`| ${id} | ${cell} |`);
    }
  }
  console.log(
    `\nask ${report.ask.majority}/${report.ask.total} (need >=8), recipe_negative ${report.recipe_negative.majority}/${report.recipe_negative.total} (need 0), coach_negative ${report.coach_negative.majority}/${report.coach_negative.total} (need <=1) => ${report.inconclusive > 0 ? `INCONCLUSIVE (${report.inconclusive} case(s) with <2 non-errored runs)` : report.pass ? "PASS" : "FAIL"}`,
  );
  process.exit(report.pass ? 0 : 1);
}

if (/probe-offer-recipe\.[tj]s$/.test(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
