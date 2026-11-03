/**
 * The PR 2 gate for the Vertex backup route (spec 2026-11-02-vertex-backup-
 * route-design §5): each `vertexBackup` row forced onto its backup and driven
 * through its REAL service function (real prompt, token cap, temperature),
 * 3 samples per row, plus coach-pro's tool loop across a route switch in both
 * directions. Reports finish_reason, tokens and latency per call; exits 1 on
 * any problem (a length finish, an error such as a 400, an empty reply, a
 * sample off the intended route).
 *
 * PR 3 adds the 21 text-only rows (drivers in ai-backup-gate-text-rows.ts),
 * PR 4 the other 8 vision rows (ai-backup-gate-vision-rows.ts; fetches its
 * photos from Wikimedia Commons and Unsplash).
 *
 * `NODE_ENV=development npm run ai:backup-gate [-- --only a,b]` — needs
 * OPENROUTER_API_KEY, the three GOOGLE_VERTEX_* vars and the local database
 * (coach-pro tools, notebook extraction). Spends real money on OpenRouter and
 * Vertex (108 samples; food-nlp-parse also calls the nutrition lookups).
 */
import { randomUUID } from "node:crypto";
import type { AiFeature } from "../server/lib/ai-models";
import type {
  AiCallContext,
  AiCallRecord,
} from "../server/lib/ai-call-context";

export type GateMode =
  | "backup"
  | "switch-or-then-vertex"
  | "switch-vertex-then-or";

export interface GateSample {
  feature: AiFeature;
  mode: GateMode;
  calls: AiCallRecord[];
  text: string;
  toolRounds: number;
  latencyMs: number;
  error?: string;
  /** Set by a driver whose service returned its stand-in for a bad reply. */
  degraded?: string;
}

/**
 * Every reason a sample stops the PR (spec §5); empty = clean. The reply text
 * alone never proves success: the chat services turn an aiChat error into an
 * apology, and a failed Vertex backup call records nothing.
 */
export function gateProblems(s: GateSample): string[] {
  const problems: string[] = [];
  if (s.error !== undefined) problems.push(s.error);
  if (s.degraded !== undefined) problems.push(`fallback value: ${s.degraded}`);
  for (const c of s.calls)
    if (c.error) problems.push(`call error: ${c.error.message}`);
  if (s.calls.some((c) => c.finishReason === "length"))
    problems.push("length finish");
  // Success records always carry finishReason; null = the stream was cut off.
  if (s.calls.some((c) => !c.error && c.finishReason === null))
    problems.push("no finish_reason");
  if (s.text.trim() === "") problems.push("no text");
  if (s.mode === "backup") {
    if (s.calls.length === 0) problems.push("no AI call recorded");
    if (s.calls.some((c) => c.answeredProvider !== "vertex"))
      problems.push("left the backup route");
  } else {
    if (s.toolRounds === 0)
      problems.push("no tool round — switch not exercised");
    const [first, second] = s.calls;
    const wantFirstVertex = s.mode === "switch-vertex-then-or";
    const answered = (c: AiCallRecord | undefined, vertex: boolean) =>
      !!c?.answeredProvider &&
      !c.error &&
      (c.answeredProvider === "vertex") === vertex;
    if (
      !answered(first, wantFirstVertex) ||
      !answered(second, !wantFirstVertex)
    )
      problems.push("route pair wrong");
  }
  return problems;
}

const VERTEX_VARS = [
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY",
] as const;
const SAMPLES = 3;
const COACH_PRO_PROMPT =
  "How much protein is in 150 g of grilled chicken breast? Please look it up.";

type Dataset = Record<string, unknown>[];
type Outcome = { text: string; toolRounds: number; degraded?: string };

/** The eval datasets' allergies are names; services take {name, severity}. */
function toProfile(p: unknown): unknown {
  if (!p) return null;
  const profile = p as { allergies: string[] };
  return {
    ...profile,
    allergies: profile.allergies.map((name) => ({
      name,
      severity: "moderate",
    })),
  };
}

function formatCall(c: AiCallRecord): string {
  const u = c.usage;
  const tokens = u
    ? `${u.prompt_tokens ?? "?"}/${u.completion_tokens ?? "?"}/${u.completion_tokens_details?.reasoning_tokens ?? 0}`
    : "n/a";
  return `${c.answeredProvider ?? "-"}:${c.answeredModel ?? "-"} finish=${c.finishReason ?? "null"} tok(in/out/reason)=${tokens}`;
}

async function main(): Promise<void> {
  await import("dotenv/config");
  if (process.env.NODE_ENV === "production") {
    console.error("ai:backup-gate refuses NODE_ENV=production.");
    process.exit(2);
  }
  const missing = [...VERTEX_VARS, "OPENROUTER_API_KEY"].filter(
    (k) => !process.env[k]?.trim(),
  );
  if (missing.length) {
    console.error(`ai:backup-gate needs ${missing.join(", ")}.`);
    process.exit(2);
  }

  const fs = await import("node:fs");
  const read = (name: string): Dataset =>
    JSON.parse(fs.readFileSync(`evals/datasets/${name}-cases.json`, "utf8"));
  const { withAiCallContext } = await import("../server/lib/ai-client");
  const coach = await import("../server/services/nutrition-coach");
  const { generateRecipeChatResponse } = await import(
    "../server/services/recipe-chat"
  );
  const { generateRecipeContent } = await import(
    "../server/services/recipe-generation"
  );
  const { analyzePhoto } = await import("../server/services/photo-analysis");
  type CoachContext = Parameters<typeof coach.generateCoachResponse>[1];
  type Profile = Parameters<typeof generateRecipeChatResponse>[1];

  // Safety cases may be answered without the model; the gate needs a reply.
  const coachCase = read("coach").find((c) => c.category !== "safety")!;
  const coachContext = coachCase.context as CoachContext;
  const chatInput = read("recipe-chat")[0].input as {
    userMessage: string;
    userProfile: unknown;
    conversationHistory: { role: "user" | "assistant"; content: string }[];
  };
  const genInput = read("recipe-generation")[0].input as Record<
    string,
    unknown
  >;
  const photoInput = read("photo-analysis")[0].input as {
    imageUrl: string;
    intent: "log";
  };
  const imgRes = await fetch(photoInput.imageUrl);
  if (!imgRes.ok) throw new Error(`photo fetch: HTTP ${imgRes.status}`);
  const imageBase64 = Buffer.from(await imgRes.arrayBuffer()).toString(
    "base64",
  );

  const coachPro = async (): Promise<Outcome> => {
    let text = "";
    let toolRounds = 0;
    for await (const chunk of coach.generateCoachProResponse(
      [{ role: "user", content: COACH_PRO_PROMPT }],
      coachContext,
      randomUUID(),
    )) {
      if (chunk.type === "content") text += chunk.content;
      else if (chunk.type === "tool_calls") toolRounds++;
    }
    return { text, toolRounds };
  };

  const run: Record<string, () => Promise<Outcome>> = {
    "coach-chat": async () => {
      let text = "";
      for await (const t of coach.generateCoachResponse(
        [{ role: "user", content: String(coachCase.userMessage) }],
        coachContext,
      ))
        text += t;
      return { text, toolRounds: 0 };
    },
    "coach-pro-chat": coachPro,
    "recipe-chat": async () => {
      let text = "";
      for await (const event of generateRecipeChatResponse(
        [
          ...chatInput.conversationHistory,
          { role: "user", content: chatInput.userMessage },
        ],
        toProfile(chatInput.userProfile) as Profile,
      )) {
        if ("done" in event && event.done) break;
        if ("content" in event && event.content) text += event.content;
        // Stop before the hero-image step, as the eval runner does.
        if ("recipe" in event && event.recipe) break;
      }
      return { text, toolRounds: 0 };
    },
    "recipe-generate": async () => {
      const recipe = await generateRecipeContent({
        ...(genInput as { productName: string }),
        userProfile: toProfile(genInput.userProfile) as Profile,
      });
      return { text: JSON.stringify(recipe), toolRounds: 0 };
    },
    "photo-analyze": async () => {
      const result = await analyzePhoto(imageBase64, photoInput.intent);
      return { text: JSON.stringify(result), toolRounds: 0 };
    },
  };

  Object.assign(
    run,
    await (await import("./ai-backup-gate-text-rows")).textRowDrivers(),
    await (await import("./ai-backup-gate-vision-rows")).visionRowDrivers(),
  );
  const onlyArg = process.argv.indexOf("--only");
  const only =
    onlyArg === -1 ? null : new Set(process.argv[onlyArg + 1]?.split(","));
  const unknown = [...(only ?? [])].filter((f) => !(f in run));
  if (unknown.length) {
    console.error(`ai:backup-gate: no driver for ${unknown.join(", ")}.`);
    process.exit(2);
  }

  const plan: {
    feature: AiFeature;
    mode: GateMode;
    force: AiCallContext["forceBackup"];
  }[] = [];
  for (const feature of Object.keys(run) as AiFeature[]) {
    if (only && !only.has(feature)) continue;
    for (let i = 0; i < SAMPLES; i++)
      plan.push({ feature, mode: "backup", force: true });
  }
  for (let i = 0; i < SAMPLES && (!only || only.has("coach-pro-chat")); i++) {
    plan.push({
      feature: "coach-pro-chat",
      mode: "switch-or-then-vertex",
      force: (n) => n >= 1,
    });
    plan.push({
      feature: "coach-pro-chat",
      mode: "switch-vertex-then-or",
      force: (n) => n === 0,
    });
  }

  let failed = 0;
  for (const p of plan) {
    // Switch runs: fallback off, so an OpenRouter failure on the unforced
    // round surfaces as an error instead of a silent Vertex answer.
    const ctx: AiCallContext = {
      overrides: {},
      fallback: p.mode === "backup" ? "on" : "off",
      calls: [],
      forceBackup: p.force,
    };
    const start = Date.now();
    let sample: GateSample;
    try {
      const out = await withAiCallContext(ctx, run[p.feature]);
      sample = {
        ...p,
        calls: ctx.calls,
        latencyMs: Date.now() - start,
        ...out,
      };
    } catch (err) {
      sample = {
        ...p,
        calls: ctx.calls,
        text: "",
        toolRounds: 0,
        latencyMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
    const problems = gateProblems(sample);
    if (problems.length) failed++;
    console.log(
      `${problems.length ? "✘" : "✔"} ${p.feature.padEnd(24)} ${p.mode.padEnd(22)} ${String(sample.latencyMs).padStart(6)}ms tools=${sample.toolRounds} chars=${sample.text.length}`,
    );
    for (const c of sample.calls) console.log(`    ${formatCall(c)}`);
    for (const problem of problems) console.log(`    PROBLEM: ${problem}`);
  }
  console.log(`\n${plan.length - failed}/${plan.length} samples clean`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && /ai-backup-gate\.(ts|js)$/.test(process.argv[1])) {
  void main();
}
