# Coach Recipe Offer Implementation Plan

> **STATUS: SHIPPED — history, not instructions.** Checked 2026-11-22: the files this plan creates are on `main`. The current code and `docs/OWNER_RULINGS.md` win over anything below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coach Pro and RecipeChef always ask before making a recipe (an offer with [Yes] [Search] [No]). Every new generation goes through a prefilled adjust card: servings, spice, time, locked allergies and 1–2 dish follow-ups. In Coach Pro, the model decides "this is a recipe ask" through a terminal `offer_recipe` tool instead of a regex.

**Architecture:** The finder state machine (`server/services/recipe-finder/`) gains two stages, `offer` and `adjust`, plus five button actions. Every former direct-generate path now builds the adjust card. The card's Generate is the only claim point.

- **Coach Pro:** the model calls the terminal `offer_recipe` tool. `generateCoachProResponse` yields a `terminal_tool` chunk, and `handleCoachChat` saves the offer before yielding it.
- **RecipeChef:** enters at the offer through `extractQuery`, which now also returns servings, spice and time.

Everything new sits behind `RECIPE_OFFER_ENABLED` (off by default; it requires `RECIPE_FINDER_ENABLED`). Flag off means byte-identical current behaviour.

**Tech Stack:** TypeScript, Express, Zod, Vitest, OpenAI SDK via `aiChat` (OpenRouter → `openai/gpt-6-luna` for `coach-pro-chat`), React Native/Expo (client), Maestro (iOS).

**Spec:** `docs/superpowers/specs/2026-10-06-coach-recipe-offer-design.md`. It is local-only and gitignored, as is this plan. Read both.

## Global Constraints

**Rulings and flags**

- Owner rulings, final; don't re-ask:
  - always ask, with no fast path to the card;
  - the adjust card is the single doorway for NEW generations;
  - refine of an on-screen card (`classifyTurn → refine_current`) is the one exception and stays unchanged;
  - RecipeChef gets the same experience;
  - Coach Pro finder **taps don't count** toward the daily message limit;
  - free Coach is unchanged.
- New flag: `RECIPE_OFFER_ENABLED === "true"`, read at call time (the `config.ts` pattern). It is effective only when `isRecipeFinderEnabled()` is also true.
- **Flag off ⇒ current behaviour exactly.** Every new branch is gated, and the existing tests must pass unmodified.

**Fixed copy (server-written, never the model's)**

- Offer: `I can make this into a recipe right here in the chat. Want me to get started?\nI can also search OCRecipes for something similar.`
- Offer button labels: `Yes`, `Search`, `No`.
- Closing message after No / Cancel: `No problem.`
- Missing dish: `Which dish did you have in mind?`

**Value ranges**

- Servings: an integer from 1 to 20.
- Spice: `mild | medium | hot`.
- Time ids: `quick | moderate | leisurely` (the profile's `COOKING_TIMES`, moved to `shared/`).
- Defaults: servings `householdSize ?? 2`, spice `mild`, time `cookingTimeAvailable ?? "moderate"`.
- Follow-ups: 0–2 questions. They never ask about allergies, servings, spice or time. On failure there are none (no fixed fallback).
- `offer_recipe` args: `dish` 1–80 chars after sanitising; `ingredients` ≤ 15 items, each ≤ 60 chars; optional `servings`/`spice`/`time` in the ranges above; `from_conversation` boolean.

**Process rules**

- Card answers must match an offered question **and** option on the stored latest `recipe_adjust` block; otherwise `invalid_for_stage`.
- The adjusted generation uses `allergenDetail: "extended"`. Other RecipeChef generation paths stay `"basic"`.
- TDD for every task. Co-locate tests in `__tests__/`. Mock storage the way `run-turn.test.ts` does.
- Don't run `test:run`, `check:types` or `lint` ad hoc; run the targeted `npx vitest run <file>` per step. Push runs `preflight:fast`.
- Feature branches only. Commit messages go through Write + `git commit -F`.

## Review Focus

1. **Tap No, then type about the same dish.** A fresh offer is expected, never a card and never a generation. Tests: Task 4 (Coach repeat = yes after a close) and Task 12 (RecipeChef, flag on).
2. **The model calls `offer_recipe` with zero text, then the client disconnects.** The offer must stay saved with the turnKey and the user row kept. Tests: Task 11 (save-before-yield) and Task 11 (route settle).
3. **An old client taps the `generate` action on an offer/adjust block** (not a valid button there). Expected: `invalid_for_stage` → quiet no-op, nothing claimed. **Typing** "generate" on an offer, however, opens the card, and on a card it generates with the prefill: the fallback text invites those commands, and both stay in the finder in both chats, never reaching the tool loop. Tests: Task 4 table tests and Task 11 entry tests.
4. **A tampered `adjust_generate`:** servings 0 or 99, spice "extreme", or an answer not offered. Expected: rejected at the schema or answer check, nothing claimed. Tests: Task 3 (schema) and Task 7 (answers).
5. **A Coach Pro conversation where the offer is not the latest message** (e.g. offer → typed chat → the coach answers in prose → tap the old Yes). Expected: stale → no-op. Test: Task 4.

---

## File Structure

| File                                                                                    | Responsibility                                                                                          |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scripts/probe-offer-recipe.ts` (create)                                                | PR 1 measurement gate: runs the corpus against the prod model with the tool list                        |
| `evals/datasets/coach-offer-recipe.json` (create)                                       | The corpus: 9 asks + 4 existing-recipe negatives + 6 ordinary-coaching negatives, each with prior turns |
| `shared/constants/cooking-times.ts` (create)                                            | `COOKING_TIME_IDS`, `COOKING_TIMES` (moved from the client)                                             |
| `client/constants/dietary-options.ts` (modify)                                          | Re-export `COOKING_TIMES` from shared                                                                   |
| `server/services/recipe-finder/config.ts` (modify)                                      | `isRecipeOfferEnabled()`                                                                                |
| `shared/schemas/recipe-finder.ts` (modify)                                              | Stages, flow `dish`/`details`, offer/adjust blocks, actions, settings                                   |
| `server/services/recipe-finder/transition.ts` (modify)                                  | Pure planning for new actions; H1 conversions gated by `opts.offer`                                     |
| `server/services/recipe-finder/fallback-text.ts` (modify)                               | Plain text for the offer/adjust blocks                                                                  |
| `server/services/recipe-finder/adjust.ts` (create)                                      | `buildAdjustBlock` (prefill precedence, avoiding, noted) and `validateAdjustAnswers`                    |
| `server/services/recipe-finder/ask-follow-ups.ts` (create)                              | `askDishFollowUps`: 0–2 dish questions via `aiChat("finder-dish-follow-ups")`                           |
| `server/services/recipe-finder/generate.ts` (modify)                                    | `mode: "adjusted"` message builder                                                                      |
| `server/services/recipe-chat.ts` (modify)                                               | `allergenDetail` option on `generateRecipeChatResponse`                                                 |
| `server/services/recipe-finder/run-turn.ts` (modify)                                    | Execute `offer_from_text`, `build_adjust`, `close`, `generate_with_settings`                            |
| `server/services/recipe-finder/extract-query.ts` (modify)                               | `extractOfferDetails`: dish + servings/spice/time                                                       |
| `server/services/recipe-finder/offer.ts` (create)                                       | `offer_recipe` args schema, `normalizeDish`, `buildOfferBlock`, `decideOfferToolCall` (repeat = yes)    |
| `server/services/recipe-finder/entry.ts` (modify)                                       | Coach/RecipeChef entry changes (H2/H3), yes/no phrases                                                  |
| `server/services/coach-tools.ts` (modify)                                               | `offer_recipe` tool definition (no execute case; it is terminal)                                        |
| `server/services/nutrition-coach.ts` (modify)                                           | `terminal_tool` chunk, per-turn tool list, safety filter                                                |
| `server/services/coach-blocks.ts` (modify)                                              | Replace `FINDER_RECIPE_RULE` with the offer rule when the offer is on                                   |
| `server/services/coach-pro-chat.ts` (modify)                                            | Entry wiring, terminal-tool save-before-yield, `runCoachFinderTurn` new entry kinds                     |
| `server/services/recipe-finder/coach-turn.ts` (modify)                                  | New entry kinds; close; adjusted generation                                                             |
| `server/routes/chat.ts` (modify)                                                        | Taps don't count; RecipeChef offer start/legacy; settle keeps blocks-only replies                       |
| `client/components/coach/blocks/recipe-offer-utils.ts` (create)                         | Pure card logic                                                                                         |
| `client/components/coach/blocks/RecipeOfferBlock.tsx`, `RecipeAdjustBlock.tsx` (create) | UI                                                                                                      |
| `client/components/coach/blocks/index.tsx` (+ RecipeChef finder renderer) (modify)      | Wire the new block types                                                                                |
| `e2e/manual/recipe-finder.yaml` (modify)                                                | iOS flows                                                                                               |

---

## PR 1: measurement gate

### Task 1: Probe `offer_recipe` against the production model

**Files:**

- Create: `evals/datasets/coach-offer-recipe.json`
- Create: `scripts/probe-offer-recipe.ts`
- Test: `scripts/__tests__/probe-offer-recipe.test.ts` (scoring only)

**Interfaces:**

- Produces:
  - `OFFER_RECIPE_TOOL: ChatCompletionTool`, defined here and imported in Task 9. The source of truth is `server/services/recipe-finder/offer.ts`. Create that file in this task with only the tool constant, so the probe and production share one description.
  - `scoreProbe(runs: ProbeRun[]): ProbeReport`.

- [ ] **Step 1: Write the dataset.** Each case is `{ id, set: "ask"|"recipe_negative"|"coach_negative", history: {role,content}[], message, routedByClassifyTurn?: boolean }`. Cases:
  - **`ask`:**
    - the owner's exact text "Can you turn that into a recipe for me?", after a user turn listing ingredients and an assistant turn suggesting "lemon garlic chicken with spinach rice";
    - "Turn that into a recipe";
    - "Can you make me a recipe for chicken thighs?";
    - "Come up with a low carb dinner recipe";
    - "Make me a healthy pasta dish";
    - "How do I make chicken curry?";
    - "Can I get the recipe for that?";
    - "Find me a high protein chicken recipe";
    - "Create a recipe with salmon and rice".
  - **`recipe_negative`**, each after an assistant recipe-card turn, with `routedByClassifyTurn: true`:
    - "that recipe was too salty";
    - "log that recipe";
    - "how many calories in that recipe";
    - "add that recipe to my meal plan".
  - **`coach_negative`:**
    - "what should I have for dinner?";
    - "what can I make with chicken, rice and spinach?";
    - "is pasta OK for my goals?";
    - "give me a few high-protein snack ideas";
    - "what's a good breakfast before a run?";
    - "I'm hungry, any ideas?".

- [ ] **Step 2: Write the failing scoring test**

```ts
import { describe, it, expect } from "vitest";
import { scoreProbe } from "../probe-offer-recipe";

describe("scoreProbe", () => {
  it("counts majority-of-3 per case and applies the pass bar", () => {
    const run = (id: string, set: string, called: boolean[]) =>
      called.map((c) => ({ id, set, called: c, reachedToolLoop: true }));
    const runs = [
      ...Array.from({ length: 9 }, (_, i) =>
        run(`a${i}`, "ask", [true, true, false]),
      ).flat(),
      ...run("r0", "recipe_negative", [false, false, false]),
      ...run("c0", "coach_negative", [true, true, false]),
      ...run("c1", "coach_negative", [false, false, false]),
    ];
    const report = scoreProbe(runs as never);
    expect(report.ask).toEqual({ majority: 9, total: 9 });
    expect(report.coach_negative).toEqual({ majority: 1, total: 2 });
    expect(report.pass).toBe(true);
  });

  it("a recipe_negative that never reaches the tool loop is not a false alarm", () => {
    const runs = [
      {
        id: "r0",
        set: "recipe_negative",
        called: false,
        reachedToolLoop: false,
      },
    ];
    expect(scoreProbe(runs as never).recipe_negative.majority).toBe(0);
  });
});
```

(Use a typed fixture builder instead of `as never` if lint rejects it, per the 2026-09-28 ledger ruling.)

- [ ] **Step 3: Run it.** `npx vitest run scripts/__tests__/probe-offer-recipe.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement**
  - `scoreProbe`: group by id, majority = at least 2 of 3 `called && reachedToolLoop`. `pass` = ask ≥ 8, recipe_negative = 0, coach_negative ≤ 1.
  - The `main()` probe:
    - For `routedByClassifyTurn` cases, first call the real `classifyTurn(message, "<card title>")`. Only `new_request`/`other` reach the tool loop; `refine_current` sets `reachedToolLoop: false`.
    - For tool-loop cases, call `aiChat("coach-pro-chat", { messages: [system: the exact production Pro system prompt for a minimal context — buildSystemPrompt(context, "personalized_advice", { tier: "pro" }), whose blocks section comes from getBlocksSystemPrompt(true, { offer: true }) (this PR, below), ...history, user], tools: [...TOOL_DEFINITIONS without search_recipes, OFFER_RECIPE_TOOL], temperature: 0.5, max_completion_tokens: 1500 })`, non-streaming, with **the same settings as production**. Set `called` = `choices[0].message.tool_calls?.some(t => t.function.name === "offer_recipe")`. (If `buildSystemPrompt` doesn't take an offer option yet, the probe passes it through the same seam Task 10 uses. Never append the rule; it must **replace** `FINDER_RECIPE_RULE`.)
    - **This PR also lands the `coach-blocks.ts` part of Task 10**: `OFFER_RECIPE_RULE` and `getBlocksSystemPrompt(finderEnabled, opts?: { offer?: boolean })`, plus its two tests (offer on: contains `offer_recipe tool`, not `ask for one directly`; default output unchanged, snapshot). It's gated and changes no default output, so the probe exercises the production prompt function itself.
    - Run each case 3×.
    - Print a table per set with denominators, and exit non-zero on fail.
  - Refuse `NODE_ENV=production` (the eval-runner pattern), and require `OPENROUTER_API_KEY`.

- [ ] **Step 5: Run the test.** Expected: PASS.

- [ ] **Step 6: Run the probe.** `npx tsx scripts/probe-offer-recipe.ts`. Paste the table into the spec under §7 "Results (date)".
  - **If it fails the bar:** STOP and report to the owner. Allow one tool-description tuning pass, then re-run. Approach 2 is the fallback.

- [ ] **Step 7: Commit.** Commit the dataset, script, test, `offer.ts` (tool constant only) and the `coach-blocks.ts` change as `feat(coach): offer_recipe probe + eval set`, then open PR 1.

---

## PR 2: server (flag off)

### Task 2: Flag + shared cooking times

**Files:**

- Modify: `server/services/recipe-finder/config.ts`
- Create: `shared/constants/cooking-times.ts`
- Modify: `client/constants/dietary-options.ts:313-317`
- Test: `server/services/recipe-finder/__tests__/config.test.ts`

**Interfaces:** Produces `isRecipeOfferEnabled(): boolean`, `COOKING_TIME_IDS`, `type CookingTimeId`.

- [ ] **Step 1: Failing test** (append to `config.test.ts`)

```ts
describe("isRecipeOfferEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("needs BOTH flags", () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
    vi.stubEnv("RECIPE_OFFER_ENABLED", "true");
    expect(isRecipeOfferEnabled()).toBe(true);
    vi.stubEnv("RECIPE_FINDER_ENABLED", "false");
    expect(isRecipeOfferEnabled()).toBe(false);
  });
  it("is off by default", () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
    vi.stubEnv("RECIPE_OFFER_ENABLED", "");
    expect(isRecipeOfferEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run server/services/recipe-finder/__tests__/config.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/** Spec 2026-10-06 §8: offer + adjust card; requires the finder. */
export function isRecipeOfferEnabled(): boolean {
  return isRecipeFinderEnabled() && process.env.RECIPE_OFFER_ENABLED === "true";
}
```

```ts
// shared/constants/cooking-times.ts
export const COOKING_TIME_IDS = ["quick", "moderate", "leisurely"] as const;
export type CookingTimeId = (typeof COOKING_TIME_IDS)[number];
export const COOKING_TIMES: {
  id: CookingTimeId;
  name: string;
  description: string;
}[] = [
  { id: "quick", name: "Quick", description: "Under 30 minutes" },
  { id: "moderate", name: "Moderate", description: "30-60 minutes" },
  { id: "leisurely", name: "Leisurely", description: "1+ hours, no rush" },
];
```

In `dietary-options.ts`, replace the local array with `export { COOKING_TIMES } from "@shared/constants/cooking-times";`. Keep the `CookingTimeOption` type compatible, and check every consumer with LSP `findReferences`.

- [ ] **Step 4: Run the test.** Expected: PASS.

- [ ] **Step 5: Commit** as `feat(recipe-finder): RECIPE_OFFER_ENABLED flag + shared cooking times`.

### Task 3: Schema

**Files:**

- Modify: `shared/schemas/recipe-finder.ts`
- Test: `shared/schemas/__tests__/recipe-finder.test.ts` (create if absent; otherwise append)

**Interfaces (produces; later tasks use these exact names):**

```ts
export const spiceLevelSchema = z.enum(["mild", "medium", "hot"]);
export type SpiceLevel = z.infer<typeof spiceLevelSchema>;
export const cookingTimeSchema = z.enum(COOKING_TIME_IDS);
export const recipeDetailsSchema = z.object({
  servings: z.number().int().min(1).max(20).optional(),
  spice: spiceLevelSchema.optional(),
  time: cookingTimeSchema.optional(),
  ingredients: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  fromConversation: z.boolean().default(false),
});
export type RecipeDetails = z.infer<typeof recipeDetailsSchema>;
// finderFlowSchema: stage z.enum(["results","clarifying","offer","adjust"]),
//   + dish: z.string().trim().min(1).max(80).optional(),
//   + details: recipeDetailsSchema.optional()
export const recipeOfferBlockSchema = z.object({
  type: z.literal("recipe_offer"),
  flow: finderFlowSchema,
});
export const adjustSettingsSchema = z.object({
  servings: z.number().int().min(1).max(20),
  spice: spiceLevelSchema,
  time: cookingTimeSchema,
});
export type AdjustSettings = z.infer<typeof adjustSettingsSchema>;
export const recipeAdjustBlockSchema = z.object({
  type: z.literal("recipe_adjust"),
  prefill: adjustSettingsSchema,
  avoiding: z.array(z.string().max(60)).max(20),
  noted: z.object({
    dietType: z.string().max(50).optional(),
    dislikes: z.array(z.string().max(60)).max(20),
  }),
  followUps: z.array(clarifyingQuestionSchema).max(2),
  flow: finderFlowSchema,
});
// finderBlockSchema: add both; isFinderBlockType: add both.
// finderActionSchema.type: + "offer_yes","offer_search","offer_no","adjust_generate","adjust_cancel"
//   + settings: adjustSettingsSchema.optional()
//   refine: type === "adjust_generate" ⇒ settings !== undefined
//   (answers stays optional; on adjust_generate it may be absent — min(1) only when present)
```

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  finderActionSchema,
  finderBlockSchema,
  isFinderBlockType,
} from "../recipe-finder";

const FID = "00000000-0000-4000-8000-000000000000";
const flow = {
  flowId: FID,
  stage: "offer",
  request: "Spaghetti and meatballs",
  query: { q: "spaghetti and meatballs" },
  round: 0,
  shownIds: [],
  dish: "Spaghetti and meatballs",
  details: { servings: 8, ingredients: [], fromConversation: false },
};

describe("offer/adjust schema", () => {
  it("parses an offer block", () => {
    expect(
      finderBlockSchema.safeParse({ type: "recipe_offer", flow }).success,
    ).toBe(true);
    expect(isFinderBlockType("recipe_offer")).toBe(true);
    expect(isFinderBlockType("recipe_adjust")).toBe(true);
  });
  it("adjust_generate requires settings", () => {
    expect(
      finderActionSchema.safeParse({ type: "adjust_generate", flowId: FID })
        .success,
    ).toBe(false);
    expect(
      finderActionSchema.safeParse({
        type: "adjust_generate",
        flowId: FID,
        settings: { servings: 8, spice: "mild", time: "moderate" },
      }).success,
    ).toBe(true);
  });
  it.each([
    [{ servings: 0, spice: "mild", time: "moderate" }],
    [{ servings: 21, spice: "mild", time: "moderate" }],
    [{ servings: 2, spice: "extreme", time: "moderate" }],
    [{ servings: 2, spice: "mild", time: "under_20" }],
  ])("rejects tampered settings %j", (settings) => {
    expect(
      finderActionSchema.safeParse({
        type: "adjust_generate",
        flowId: FID,
        settings,
      }).success,
    ).toBe(false);
  });
  it("old results blocks still parse (flow without dish/details)", () => {
    expect(
      finderBlockSchema.safeParse({
        type: "recipe_results",
        source: "community",
        items: [],
        actions: [],
        notice: "no_matches",
        flow: {
          ...flow,
          stage: "results",
          dish: undefined,
          details: undefined,
        },
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run them.** `npx vitest run shared/schemas/__tests__/recipe-finder.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above in `recipe-finder.ts`.
- [ ] **Step 4: Run them**, plus the existing finder tests: `npx vitest run shared/schemas server/services/recipe-finder`. Expected: all PASS. Exhaustive `switch`es over `FinderBlock["type"]` will now fail type-check (`fallback-text.ts`); Task 5 fixes them. Until then, add a `default` case that throws "unhandled block", so this commit compiles.
- [ ] **Step 5: Commit** as `feat(recipe-finder): offer/adjust schema`.

### Task 4: Transition: new actions + H1 conversions + repeat/close semantics

**Files:**

- Modify: `server/services/recipe-finder/transition.ts`
- Test: `server/services/recipe-finder/__tests__/transition.test.ts`

**Interfaces:**

- Consumes: Task 3 types.
- Produces:

```ts
export interface PlanOptions { offer: boolean }  // default { offer: false }
export type TypedFinderCommand = "generate" | "none_of_these" | "yes" | "no" | "search";
export type FinderInput =
  | { kind: "start"; text: string }
  | { kind: "offer"; dish: string; details: RecipeDetails } // Coach tool path
  | { kind: "action"; action: FinderAction }
  | { kind: "typed"; text: string; command: TypedFinderCommand | null };
// existing search_community step gains: dish?: string; details?: RecipeDetails
export type FinderStep =
  | ...existing
  | { kind: "offer_from_text"; text: string }                         // RecipeChef start, offer on
  | { kind: "offer"; dish: string; details: RecipeDetails }            // Coach tool path
  | { kind: "build_adjust"; flow: FinderFlow }
  | { kind: "close" }
  | { kind: "generate_with_settings"; flow: FinderFlow; settings: AdjustSettings; answers: FinderAnswer[] };
export function planFinderStep(latest: FinderBlock | null, input: FinderInput, opts?: PlanOptions): FinderStep;
```

Rules, applied only when `opts.offer`. Otherwise the current code path runs untouched, **except** that the five new action types (`offer_yes`, `offer_search`, `offer_no`, `adjust_generate`, `adjust_cancel`) and the new typed commands (`yes`, `no`, `search`) return `{ kind: "ignore", reason: "invalid_for_stage" }` with the flag off. The old `switch` must never fall through to `undefined`, e.g. after a flag flip-off with offer blocks still in history.

**The single transition table (offer on).** "typed other" = typed text with no command match.

| Latest block       | Tap action → step                                                                                                                                                    | Typed command → step                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| none               | any action → `ignore no_active_flow`                                                                                                                                 | n/a (entry decides; see Tasks 11/12)                                                                                                                                                                   |
| `recipe_offer`     | `offer_yes` → `build_adjust`; `offer_search` → `search_community` (round 0, **carries `dish`+`details`**); `offer_no` → `close`; anything else → `invalid_for_stage` | `yes` → `build_adjust`; `search` → as `offer_search`; `no` → `close`; `generate` → `build_adjust`; typed other → `offer_from_text` (RecipeChef only; Coach sends other text to the tool loop, Task 11) |
| `recipe_adjust`    | `adjust_generate` → `generate_with_settings`; `adjust_cancel` → `close`; anything else → `invalid_for_stage`                                                         | `generate` / `yes` → `generate_with_settings` (latest `prefill`, no answers); `no` → `close`; typed other → `offer_from_text` (RecipeChef only; Coach → tool loop)                                     |
| `recipe_results`   | `generate` → `build_adjust`; `search_online`, `none_of_these` as today, except round-1 None of these → `build_adjust`; offer/adjust actions → `invalid_for_stage`    | `generate` → `build_adjust`; `none_of_these` as today (round 1 → `build_adjust`); typed other → today's refinement search                                                                              |
| `recipe_questions` | `answers` as today; `generate` → `build_adjust`; others → `invalid_for_stage`                                                                                        | `generate` → `build_adjust` (its fallback text invites typing "generate"; the client has no Generate button there, only Submit); typed other → answers, as today                                       |

Other rules:

- Input `start` → `offer_from_text`. Input `offer` (Coach tool) → `offer`.
- **`search_community` carries the offer context.** The step gains optional `dish?: string; details?: RecipeDetails`. `finderOutcome` copies them into the results flow it builds, so a later Generate's adjust card keeps "for 8". Task 6 uses `flow.dish`/`flow.details` when present and falls back to `query.q` only when they're absent.
- `finderOutcome` for `search_community` with zero results in round 1 → `{ kind: "build_adjust", flow }` (H1.3). Add the `FinderOutcome` arm `{ kind: "build_adjust"; flow: FinderFlow }`. `finderOutcome` gains a 4th param `opts?: PlanOptions`.
- `finderStatusLabel`:
  - `offer_from_text`, `offer`, `close` → `null`;
  - `build_adjust` → `"Setting up your recipe…"`;
  - `generate_with_settings` → `"Creating your recipe…"`.

- [ ] **Step 1: Failing tests** (append; reuse the file's `flow()`, `results()`, `questions()` helpers, and add the helpers below)

```ts
const ON = { offer: true };
const offerBlock = (over = {}) => ({
  type: "recipe_offer" as const,
  flow: flow({
    stage: "offer",
    dish: "Spaghetti and meatballs",
    details: { servings: 8, ingredients: [], fromConversation: false },
  }),
  ...over,
});
const adjustBlock = () => ({
  type: "recipe_adjust" as const,
  prefill: { servings: 8, spice: "mild" as const, time: "moderate" as const },
  avoiding: [],
  noted: { dislikes: [] },
  followUps: [
    { question: "Beef, pork, or a mix?", options: ["Beef", "Mix", "Pork"] },
  ],
  flow: flow({ stage: "adjust", dish: "Spaghetti and meatballs" }),
});
const act = (type: string, extra = {}) => ({
  kind: "action" as const,
  action: { type, flowId: F0, ...extra } as FinderAction,
});

describe("planFinderStep — offer on (H1: every direct-generate path → build_adjust)", () => {
  it("generate action on a results list → build_adjust", () => {
    expect(planFinderStep(results(), act("generate"), ON).kind).toBe(
      "build_adjust",
    );
  });
  it("generate action on an adjust/offer/questions block → invalid_for_stage", () => {
    for (const b of [adjustBlock(), offerBlock(), questions()]) {
      expect(planFinderStep(b as FinderBlock, act("generate"), ON)).toEqual({
        kind: "ignore",
        reason: "invalid_for_stage",
      });
    }
  });
  it("second None of these → build_adjust", () => {
    expect(
      planFinderStep(
        results({ flow: flow({ round: 1 }) }),
        act("none_of_these"),
        ON,
      ).kind,
    ).toBe("build_adjust");
  });
  it("typed generate → build_adjust on results, questions and offer; generate_with_settings on adjust", () => {
    const typed = {
      kind: "typed" as const,
      text: "generate",
      command: "generate" as const,
    };
    expect(planFinderStep(results(), typed, ON).kind).toBe("build_adjust");
    expect(planFinderStep(questions(), typed, ON).kind).toBe("build_adjust");
    expect(planFinderStep(offerBlock() as FinderBlock, typed, ON).kind).toBe(
      "build_adjust",
    );
    expect(
      planFinderStep(adjustBlock() as FinderBlock, typed, ON),
    ).toMatchObject({
      kind: "generate_with_settings",
      settings: { servings: 8, spice: "mild", time: "moderate" },
      answers: [],
    });
  });
  it("generate ACTION on questions → build_adjust (old clients / fallback)", () => {
    expect(planFinderStep(questions(), act("generate"), ON).kind).toBe(
      "build_adjust",
    );
  });
  it("typed yes/search/no on an offer", () => {
    const t = (command: "yes" | "no" | "search") => ({
      kind: "typed" as const,
      text: command,
      command,
    });
    expect(planFinderStep(offerBlock() as FinderBlock, t("yes"), ON).kind).toBe(
      "build_adjust",
    );
    expect(
      planFinderStep(offerBlock() as FinderBlock, t("search"), ON),
    ).toMatchObject({
      kind: "search_community",
      dish: "Spaghetti and meatballs",
    });
    expect(planFinderStep(offerBlock() as FinderBlock, t("no"), ON)).toEqual({
      kind: "close",
    });
  });
  it("offer_search carries dish + details into the results flow", () => {
    const step = planFinderStep(
      offerBlock() as FinderBlock,
      act("offer_search"),
      ON,
    );
    const out = finderOutcome(
      step,
      {
        kind: "community",
        query: { q: "spaghetti meatballs" },
        items: [item(3)],
      },
      ctx(),
      ON,
    );
    expect(out.kind === "message" && out.block.flow).toMatchObject({
      dish: "Spaghetti and meatballs",
      details: { servings: 8 },
    });
  });
  it("round-1 zero results → build_adjust outcome, not generate", () => {
    const step = {
      kind: "search_community",
      request: "x",
      round: 1,
      excludeIds: [],
      priorShownIds: [],
    } as FinderStep;
    const out = finderOutcome(
      step,
      { kind: "community", query: { q: "x" }, items: [] },
      ctx(),
      ON,
    );
    expect(out.kind).toBe("build_adjust");
  });
});

describe("offer/adjust actions", () => {
  it("offer_yes → build_adjust; offer_search → round-0 community search; offer_no → close", () => {
    expect(
      planFinderStep(offerBlock() as FinderBlock, act("offer_yes"), ON).kind,
    ).toBe("build_adjust");
    expect(
      planFinderStep(offerBlock() as FinderBlock, act("offer_search"), ON),
    ).toMatchObject({
      kind: "search_community",
      round: 0,
      dish: "Spaghetti and meatballs",
    });
    expect(
      planFinderStep(offerBlock() as FinderBlock, act("offer_no"), ON),
    ).toEqual({ kind: "close" });
  });
  it("adjust_generate carries settings + answers; adjust_cancel closes", () => {
    const settings = {
      servings: 6,
      spice: "hot" as const,
      time: "quick" as const,
    };
    const answers = [{ question: "Beef, pork, or a mix?", answer: "Mix" }];
    expect(
      planFinderStep(
        adjustBlock() as FinderBlock,
        act("adjust_generate", { settings, answers }),
        ON,
      ),
    ).toMatchObject({ kind: "generate_with_settings", settings, answers });
    expect(
      planFinderStep(adjustBlock() as FinderBlock, act("adjust_cancel"), ON),
    ).toEqual({ kind: "close" });
  });
  it("offer actions on the wrong stage are invalid", () => {
    expect(planFinderStep(results(), act("offer_yes"), ON)).toEqual({
      kind: "ignore",
      reason: "invalid_for_stage",
    });
    expect(
      planFinderStep(
        offerBlock() as FinderBlock,
        act("adjust_generate", {
          settings: { servings: 2, spice: "mild", time: "quick" },
        }),
        ON,
      ),
    ).toEqual({ kind: "ignore", reason: "invalid_for_stage" });
  });
  it("stale offer (other flowId) → stale_flow", () => {
    const b = offerBlock({ flow: flow({ flowId: F_OTHER, stage: "offer" }) });
    expect(planFinderStep(b as FinderBlock, act("offer_yes"), ON)).toEqual({
      kind: "ignore",
      reason: "stale_flow",
    });
  });
  it("no live block (closing message is latest) → no_active_flow", () => {
    expect(planFinderStep(null, act("offer_yes"), ON)).toEqual({
      kind: "ignore",
      reason: "no_active_flow",
    });
  });
  it("start → offer_from_text; offer input → offer", () => {
    expect(
      planFinderStep(null, { kind: "start", text: "spaghetti for 8" }, ON),
    ).toEqual({ kind: "offer_from_text", text: "spaghetti for 8" });
    const details = { ingredients: [], fromConversation: true };
    expect(
      planFinderStep(
        null,
        { kind: "offer", dish: "Lemon chicken", details },
        ON,
      ),
    ).toEqual({ kind: "offer", dish: "Lemon chicken", details });
  });
});

describe("flag off is unchanged", () => {
  it("generate action still generates directly", () => {
    expect(planFinderStep(results(), act("generate")).kind).toBe("generate");
  });
  it("new action types with the flag off → invalid_for_stage, never undefined", () => {
    for (const type of [
      "offer_yes",
      "offer_search",
      "offer_no",
      "adjust_cancel",
    ]) {
      expect(planFinderStep(offerBlock() as FinderBlock, act(type))).toEqual({
        kind: "ignore",
        reason: "invalid_for_stage",
      });
    }
    expect(
      planFinderStep(
        adjustBlock() as FinderBlock,
        act("adjust_generate", {
          settings: { servings: 2, spice: "mild", time: "quick" },
        }),
      ),
    ).toEqual({ kind: "ignore", reason: "invalid_for_stage" });
  });
});
```

(`ctx()` is the file's existing `FinderCtx` helper. If it doesn't exist, define `const ctx = (): FinderCtx => ({ onlineConfigured: true, canSearchOnline: true, canGenerate: true, nextFlowId: NEXT })`.)

- [ ] **Step 2: Run them.** `npx vitest run server/services/recipe-finder/__tests__/transition.test.ts`. Expected: the new tests FAIL and the old ones PASS.
- [ ] **Step 3: Implement** the rules above. Keep each new branch inside `if (opts.offer) { … }`, placed **before** the existing logic, so the flag-off path is literally the old code.
- [ ] **Step 4: Run them.** Expected: all PASS.
- [ ] **Step 5: Commit** as `feat(recipe-finder): offer/adjust transitions; every generate path → adjust card`.

### Task 5: Fallback text for offer/adjust

**Files:** Modify `server/services/recipe-finder/fallback-text.ts`. Test: `__tests__/fallback-text.test.ts`.

**Interfaces:** `finderFallbackText(block)` handles the two new types. Remove Task 3's throwing default.

- [ ] **Step 1: Failing tests**

```ts
it("offer text is the fixed copy + typed hints", () => {
  expect(finderFallbackText(offerBlock)).toBe(
    'I can make this into a recipe right here in the chat. Want me to get started?\nI can also search OCRecipes for something similar.\n\nReply "yes", "search", or "no".',
  );
});
it("adjust text lists the prefill and how to proceed", () => {
  expect(finderFallbackText(adjustBlock)).toBe(
    'Spaghetti and meatballs — 8 servings, mild, 30-60 minutes.\n\nReply "generate" to make it.',
  );
});
```

(The time label comes from `COOKING_TIMES.find(t => t.id === prefill.time)!.description`.)

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Export `OFFER_TEXT` (the first two lines) for reuse in Task 11.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: Adjust block builder + dish follow-ups

**Files:**

- Create: `server/services/recipe-finder/adjust.ts`
- Create: `server/services/recipe-finder/ask-follow-ups.ts`
- Test: `__tests__/adjust.test.ts`, `__tests__/ask-follow-ups.test.ts`

**Interfaces:**

```ts
// adjust.ts
export function buildAdjustBlock(args: {
  flow: FinderFlow; // must carry dish (+ details)
  profile: UserProfile | null | undefined;
  followUps: ClarifyingQuestion[];
  nextFlowId: string;
}): RecipeAdjustBlock;
export function validateAdjustAnswers(
  block: RecipeAdjustBlock,
  answers: FinderAnswer[],
): boolean;
// ask-follow-ups.ts
export async function askDishFollowUps(
  dish: string,
  details: RecipeDetails,
  transcript: { role: "user" | "assistant"; content: string }[],
): Promise<ClarifyingQuestion[]>; // 0–2, [] on any failure
```

`buildAdjustBlock` uses `flow.dish`/`flow.details` when present (an offer flow, or a results flow reached via Search, which carries them per Task 4). Only when they're absent (a plain results list) does it use `flow.query.q` as the dish and `{ ingredients: [], fromConversation: false }` as the details. Either way it sets `flow.stage = "adjust"`, `flow.flowId = nextFlowId` and `flow.dish`.

- [ ] **Step 1: Failing tests** (`adjust.test.ts`)

```ts
const profile = (over = {}) =>
  ({
    householdSize: 4,
    cookingTimeAvailable: "quick",
    allergies: [{ name: "peanuts", severity: "severe" }],
    dietType: "pescatarian",
    foodDislikes: ["olives"],
    ...over,
  }) as unknown as UserProfile;

it("chat details beat profile beat defaults", () => {
  const b = buildAdjustBlock({
    flow: offerFlow({
      details: {
        servings: 8,
        spice: "hot",
        ingredients: [],
        fromConversation: false,
      },
    }),
    profile: profile(),
    followUps: [],
    nextFlowId: NEXT,
  });
  expect(b.prefill).toEqual({ servings: 8, spice: "hot", time: "quick" });
});
it("profile beats defaults; defaults when no profile", () => {
  expect(
    buildAdjustBlock({
      flow: offerFlow(),
      profile: profile(),
      followUps: [],
      nextFlowId: NEXT,
    }).prefill,
  ).toEqual({ servings: 4, spice: "mild", time: "quick" });
  expect(
    buildAdjustBlock({
      flow: offerFlow(),
      profile: null,
      followUps: [],
      nextFlowId: NEXT,
    }).prefill,
  ).toEqual({ servings: 2, spice: "mild", time: "moderate" });
});
it("an unknown profile time value falls back to moderate", () => {
  expect(
    buildAdjustBlock({
      flow: offerFlow(),
      profile: profile({ cookingTimeAvailable: "whenever" }),
      followUps: [],
      nextFlowId: NEXT,
    }).prefill.time,
  ).toBe("moderate");
});
it("avoiding always lists allergies; noted carries diet + dislikes", () => {
  const b = buildAdjustBlock({
    flow: offerFlow(),
    profile: profile(),
    followUps: [],
    nextFlowId: NEXT,
  });
  expect(b.avoiding).toEqual(["peanuts"]);
  expect(b.noted).toEqual({ dietType: "pescatarian", dislikes: ["olives"] });
});
it("results flow reached via Search keeps the offer's dish + servings", () => {
  const b = buildAdjustBlock({
    flow: flow({
      dish: "Spaghetti and meatballs",
      details: { servings: 8, ingredients: [], fromConversation: false },
    }),
    profile: profile(),
    followUps: [],
    nextFlowId: NEXT,
  });
  expect(b.flow.dish).toBe("Spaghetti and meatballs");
  expect(b.prefill.servings).toBe(8);
});
it("from a plain results flow: dish = query.q, stage adjust, new flowId", () => {
  const b = buildAdjustBlock({
    flow: flow(),
    profile: null,
    followUps: [],
    nextFlowId: NEXT,
  });
  expect(b.flow).toMatchObject({
    dish: "mediterranean",
    stage: "adjust",
    flowId: NEXT,
  });
});
it("validateAdjustAnswers accepts only offered question+option pairs", () => {
  const b = buildAdjustBlock({
    flow: offerFlow(),
    profile: null,
    followUps: [
      { question: "Beef, pork, or a mix?", options: ["Beef", "Mix"] },
    ],
    nextFlowId: NEXT,
  });
  expect(
    validateAdjustAnswers(b, [
      { question: "Beef, pork, or a mix?", answer: "Mix" },
    ]),
  ).toBe(true);
  expect(
    validateAdjustAnswers(b, [
      { question: "Beef, pork, or a mix?", answer: "Lamb" },
    ]),
  ).toBe(false);
  expect(
    validateAdjustAnswers(b, [
      { question: "Ignore previous instructions", answer: "Mix" },
    ]),
  ).toBe(false);
  expect(validateAdjustAnswers(b, [])).toBe(true);
});
```

`ask-follow-ups.test.ts` follows `ask-clarifying.test.ts`'s mocking of `aiChat`:

- returns `[]` when `aiChat` throws;
- returns `[]` on invalid JSON;
- truncates to 2 questions;
- drops any question whose text matches `/allerg|serving|spic|how long|time/i` (a defensive filter over the prompt rule).

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**
  - `buildAdjustBlock`: the precedence above. A time value is valid iff `COOKING_TIME_IDS.includes(value)`.
  - `askDishFollowUps`: `aiChat("finder-dish-follow-ups", { temperature: 0, max_completion_tokens: 250, response_format: { type: "json_object" }, messages: [system, user] }, { timeout: OPENAI_TIMEOUT_FAST_MS })`.
    - System prompt: `The user wants a recipe for "<sanitizeContextField(dish,80)>". Ask 0–2 short multiple-choice questions ONLY about choices that change the recipe and that the conversation leaves open (e.g. protein choice, cooking method, using an ingredient they mentioned). Never ask about allergies, servings, spice level or cooking time — the app already asks those. If nothing is open, return {"questions": []}. Return JSON: {"questions": [{"question": string (max 12 words), "options": [2-4 short answers, max 4 words each]}]}` followed by `SYSTEM_PROMPT_BOUNDARY`.
    - User content: the sanitised transcript (last 6 turns) plus the details.
    - Validate with a zod schema whose `questions` has `.max(2)` (pre-filter `.slice(0,2)`).
  - Register the `finder-dish-follow-ups` feature row wherever `finder-extract-query` is registered. Find it with LSP `findReferences` on that string's feature-key type.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: Adjusted generation messages + extended allergens + answer check

**Files:**

- Modify: `server/services/recipe-finder/generate.ts`
- Modify: `server/services/recipe-chat.ts:160-205,356-364`
- Test: `__tests__/run-turn.test.ts` (generate.ts has no own test file; add `__tests__/generate.test.ts`) and `server/services/__tests__/recipe-chat.test.ts`

**Interfaces:**

```ts
// generate.ts
export function buildFinderGenerationMessages(
  input:
    | { mode: "fresh"; request: string }
    | { mode: "refine"; history: ChatMessage[] }
    | { mode: "adjusted"; dish: string; details: RecipeDetails; settings: AdjustSettings; answers: FinderAnswer[]; history: ChatMessage[] },
): GenerationMessages;
// recipe-chat.ts
generateRecipeChatResponse(messages, userProfile, imageAnalysis?, options?: { systemPromptOverride?: string; allergenDetail?: "basic" | "extended" })
```

- [ ] **Step 1: Failing tests** (`generate.test.ts`)

```ts
it("adjusted: structured settings as fixed lines, last message is the request", () => {
  const msgs = buildFinderGenerationMessages({
    mode: "adjusted",
    dish: "Spaghetti and meatballs",
    details: { ingredients: ["ground beef"], fromConversation: false },
    settings: { servings: 8, spice: "medium", time: "quick" },
    answers: [{ question: "Beef, pork, or a mix?", answer: "Mix" }],
    history: [],
  });
  expect(msgs.at(-1)).toEqual({
    role: "user",
    content:
      "Create a recipe for: Spaghetti and meatballs\nServings: 8\nSpice level: medium\nTime available: Under 30 minutes\nUse these ingredients: ground beef\nBeef, pork, or a mix? Mix",
  });
});
it("adjusted + fromConversation prepends the refine-style conversation context", () => {
  const history = [
    userMsg("I have chicken, spinach, rice"),
    assistantMsg("Try lemon garlic chicken with spinach rice"),
  ];
  const msgs = buildFinderGenerationMessages({
    mode: "adjusted",
    dish: "Lemon garlic chicken",
    details: { ingredients: [], fromConversation: true },
    settings: { servings: 2, spice: "mild", time: "moderate" },
    answers: [],
    history,
  });
  expect(msgs.slice(0, -1)).toEqual(buildRecipeContext(history));
  expect(msgs.at(-1)!.content).toContain(
    "Create a recipe for: Lemon garlic chicken",
  );
});
```

`recipe-chat.test.ts`: `generateRecipeChatResponse(..., { allergenDetail: "extended" })` → the system prompt passed to the mocked `aiChat` contains `CRITICAL ALLERGY RESTRICTIONS`. Without the option it contains `MUST AVOID these allergens`.

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**
  - The `adjusted` branch: `[...(details.fromConversation ? buildRecipeContext(history) : []), { role: "user", content: lines.join("\n") }]`.
  - The ingredients line is present only when there are ingredients. Answers render as `${q} ${a}`. Every free-ish string (dish, ingredients) passes through `sanitizeContextField(…, 80|60)`.
  - Thread `allergenDetail` into `buildSystemPrompt(userProfile, { allergenDetail })` (default `"basic"`).
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: Execute the new steps in `run-turn.ts`

**Files:** Modify `server/services/recipe-finder/run-turn.ts`. Test: `__tests__/run-turn.test.ts`.

**Interfaces:**

```ts
export interface FinderTurnContext { ...existing; offer?: boolean } // passes PlanOptions through
export type FinderTurnResult =
  | { kind: "ignored" }
  | { kind: "message"; content: string; block: FinderBlock }
  | { kind: "close"; content: "No problem." }
  | { kind: "plain"; content: string }    // offer_from_text found no dish
  | { kind: "generate"; request: string; messages: GenerationMessages; allergenDetail?: "extended" };
export function prepareFinderTurn(history, input, opts?: PlanOptions): { latest; step };
```

Step execution:

- **`offer_from_text`:** `extractOfferDetails(text, history)` (Task 12).
  - Dish null → `{ kind: "plain", content: "Which dish did you have in mind?" }`.
  - Otherwise → `message` with `buildOfferBlock(...)` (Task 9).
- **`offer`:** → `message` with `buildOfferBlock(dish, details, nextFlowId)`.
- **`build_adjust`:** `askDishFollowUps(dish, details, recentTranscript(history))`, then `buildAdjustBlock` → `message`. **No claim.**
- **`close`:** → `{ kind: "close", content: "No problem." }`.
- **`generate_with_settings`:**
  1. `validateAdjustAnswers(latest as RecipeAdjustBlock, answers)`. False → `{ kind: "ignored" }`, nothing claimed.
  2. Then the gate (`gateRecipeGeneration`, unchanged).
  3. Then `{ kind: "generate", messages: buildFinderGenerationMessages({ mode: "adjusted", … }), allergenDetail: "extended" }`. Blocked gate → the existing `blockedGenerateBlock` path.
- **The `build_adjust` outcome** from a zero-result search runs the same `build_adjust` code.

`executeFinderStep(step, ctx)` needs `latest` for the answer check. Add `latest?: FinderBlock | null` to `FinderTurnContext`. Callers pass `prepareFinderTurn(...).latest`.

- [ ] **Step 1: Failing tests**, following the file's mock style. Also mock `../ask-follow-ups`, `../extract-query`'s `extractOfferDetails`, and `../offer`'s `buildOfferBlock` (real implementation OK).
  - `build_adjust` → a message whose block parses with `finderBlockSchema` and `type === "recipe_adjust"`; `storage.claimRecipeGeneration` **not called**.
  - `generate_with_settings` with a valid answer → claim called once; result `generate`, with messages ending in `Create a recipe for:` and `allergenDetail: "extended"`.
  - `generate_with_settings` with an un-offered answer → `ignored`, claim **not called**.
  - `close` → `{ kind: "close", content: "No problem." }`, nothing claimed.
  - `offer_from_text` with dish null → `plain` "Which dish did you have in mind?".
  - Limit reached on `generate_with_settings` → message with the `generate_limit` notice.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS (old tests unchanged).
- [ ] **Step 5: Commit.**

### Task 9: `offer.ts`: tool args, dish normalisation, offer block, repeat = yes

**Files:** Modify `server/services/recipe-finder/offer.ts` (created in Task 1). Test: `__tests__/offer.test.ts`.

**Interfaces:**

```ts
export const OFFER_RECIPE_TOOL: ChatCompletionTool; // (Task 1)
export const offerRecipeArgsSchema: z.ZodType<{
  dish: string;
  from_conversation: boolean;
  servings?: number;
  spice?: SpiceLevel;
  time?: CookingTimeId;
  ingredients?: string[];
}>;
export function normalizeDish(dish: string): string;
export function buildOfferBlock(
  dish: string,
  details: RecipeDetails,
  flowId: string,
): RecipeOfferBlock;
export type OfferToolDecision =
  | { kind: "invalid" }
  | { kind: "offer"; dish: string; details: RecipeDetails }
  | { kind: "adjust"; flow: FinderFlow } // repeat = yes on a live offer
  | { kind: "repost_adjust"; block: RecipeAdjustBlock }; // same dish re-called while ITS card is live
export function decideOfferToolCall(
  rawArgs: string,
  latest: FinderBlock | null,
): OfferToolDecision;
```

- [ ] **Step 1: Failing tests**

```ts
it.each([
  ["Spaghetti & Meatballs", "spaghetti and meatballs"],
  ["The spaghetti and meatballs!", "spaghetti and meatballs"],
  ["  a  Lemon-Garlic chicken ", "lemon garlic chicken"],
])("normalizeDish(%s)", (a, b) => expect(normalizeDish(a)).toBe(b));

it("invalid JSON / empty dish / junk → invalid", () => {
  expect(decideOfferToolCall("{", null).kind).toBe("invalid");
  expect(
    decideOfferToolCall(
      JSON.stringify({ dish: "  ", from_conversation: false }),
      null,
    ).kind,
  ).toBe("invalid");
  expect(
    decideOfferToolCall(
      JSON.stringify({ dish: "x".repeat(200), from_conversation: false }),
      null,
    ).kind,
  ).toBe("invalid");
});
it("valid → offer with mapped details", () => {
  expect(
    decideOfferToolCall(
      JSON.stringify({
        dish: "Spaghetti and meatballs",
        from_conversation: false,
        servings: 8,
      }),
      null,
    ),
  ).toEqual({
    kind: "offer",
    dish: "Spaghetti and meatballs",
    details: { servings: 8, ingredients: [], fromConversation: false },
  });
});
it("repeat = yes: same dish while that offer is the latest live block → adjust", () => {
  const latest = buildOfferBlock(
    "Spaghetti & meatballs",
    { ingredients: [], fromConversation: false },
    F0,
  );
  expect(
    decideOfferToolCall(
      JSON.stringify({
        dish: "spaghetti and meatballs",
        from_conversation: false,
      }),
      latest,
    ).kind,
  ).toBe("adjust");
});
it("different dish while an offer is live → a fresh offer", () => {
  const latest = buildOfferBlock(
    "Spaghetti",
    { ingredients: [], fromConversation: false },
    F0,
  );
  expect(
    decideOfferToolCall(
      JSON.stringify({ dish: "Salmon bowl", from_conversation: false }),
      latest,
    ).kind,
  ).toBe("offer");
});
it("same dish re-called while its adjust card is live → repost that card (no offer→card→offer loop)", () => {
  const card = {
    type: "recipe_adjust" as const,
    prefill: { servings: 8, spice: "mild" as const, time: "moderate" as const },
    avoiding: [],
    noted: { dislikes: [] },
    followUps: [],
    flow: {
      ...buildOfferBlock(
        "Chili",
        { ingredients: [], fromConversation: false },
        F0,
      ).flow,
      stage: "adjust" as const,
    },
  };
  expect(
    decideOfferToolCall(
      JSON.stringify({ dish: "chili", from_conversation: false }),
      card,
    ),
  ).toEqual({ kind: "repost_adjust", block: card });
});
it("different dish while a card is live → a fresh offer", () => {
  const card = {
    type: "recipe_adjust" as const,
    prefill: { servings: 2, spice: "mild" as const, time: "moderate" as const },
    avoiding: [],
    noted: { dislikes: [] },
    followUps: [],
    flow: {
      ...buildOfferBlock(
        "Chili",
        { ingredients: [], fromConversation: false },
        F0,
      ).flow,
      stage: "adjust" as const,
    },
  };
  expect(
    decideOfferToolCall(
      JSON.stringify({ dish: "Salmon bowl", from_conversation: false }),
      card,
    ).kind,
  ).toBe("offer");
});
it("after No (latest is null — closing message has no block) → a fresh offer, never adjust", () => {
  expect(
    decideOfferToolCall(
      JSON.stringify({ dish: "Spaghetti", from_conversation: false }),
      null,
    ).kind,
  ).toBe("offer");
});
it("ingredients sanitized and capped", () => {
  const d = decideOfferToolCall(
    JSON.stringify({
      dish: "Stir fry",
      from_conversation: true,
      ingredients: Array(20).fill("rice"),
    }),
    null,
  );
  expect(d.kind === "offer" && d.details.ingredients.length).toBe(15);
});
```

- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**
  - `normalizeDish`: lowercase; `&` → `and`; strip punctuation `[^a-z0-9 ]` → space; drop leading `a|an|the`; collapse spaces.
  - `buildOfferBlock`: `flow = { flowId, stage: "offer", request: [dish, details.servings && \`for ${details.servings}\`, details.ingredients.length && \`with ${details.ingredients.join(", ")}\`].filter(Boolean).join(" "), query: { q: dish.slice(0,200) }, round: 0, shownIds: [], dish, details }`.
  - Sanitise dish and ingredients with `sanitizeContextField` before the schema check, and slice ingredients to 15.
  - `OFFER_RECIPE_TOOL` description, verbatim from Task 1 (keep in sync): "Offer to make a recipe for a specific dish. Call this when the user wants a recipe or cooking instructions for a dish — including asking you to turn a dish you suggested into a recipe ('turn that into a recipe', 'how do I make that?'). Call it without any other text. If you cannot name a concrete dish, ask the user which dish in plain text instead of calling this. Do NOT call it for meal ideas or suggestions (answer those yourself), or for questions about an existing recipe (its calories, logging it, adding it to a plan, opinions about it)."
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 10: Coach Pro generator: per-turn tools, `terminal_tool` chunk, prompt rule

**Files:**

- Modify: `server/services/nutrition-coach.ts:50-52,617-660,793-830`
- (`server/services/coach-blocks.ts` already landed in PR 1 / Task 1)
- Test: `server/services/__tests__/nutrition-coach.test.ts` (or the existing Pro tool-loop test file; find it with `grep -l generateCoachProResponse server/services/__tests__`), `server/services/__tests__/coach-blocks.test.ts`

**Interfaces:**

```ts
export type CoachProChunk =
  | { type: "content"; content: string }
  | { type: "tool_calls"; toolNames: string[] }
  | { type: "terminal_tool"; name: "offer_recipe"; args: string };
// generateCoachProResponse(..., tz, options?: { offerRecipe?: boolean })
export function getBlocksSystemPrompt(
  finderEnabled: boolean,
  opts?: { offer?: boolean },
): string;
```

Behaviour:

- **Tool list.** `options.offerRecipe && resolvedIntent !== "safety_refusal"` → append `OFFER_RECIPE_TOOL`. This is the per-turn filter (L3). Check the exact safety intent value in `coach-intent-classifier.ts`; `decideCoachFinderEntry` uses `"safety_refusal"`.
- **Terminal handling.** After a round, if `finishReason === "tool_calls"` and any pending call is `offer_recipe`:
  - yield the round's content (already done above);
  - then `yield { type: "terminal_tool", name: "offer_recipe", args }` and `return`;
  - do NOT yield `tool_calls`, and do NOT execute or append the other tool calls (dropped; spec §4.2).
- **The prompt rule** when `opts.offer`:
  - replace `FINDER_RECIPE_RULE` with `OFFER_RECIPE_RULE = "- When the user wants a recipe or cooking instructions for a dish — including a dish you suggested — call the offer_recipe tool instead of writing the recipe yourself. Never write out full recipes (ingredient lists with quantities and steps) in chat. Meal ideas and suggestions are fine in prose."`;
  - keep `FINDER_RECIPE_CARD_RULE`.

- [ ] **Step 1: Failing tests.** Mock `aiChat` streaming the way the existing Pro tests do.
  - A stream with `finish_reason: "tool_calls"` and one `offer_recipe` call (args `{"dish":"Chili","from_conversation":false}`) and no content → the chunks are exactly `[{ type: "terminal_tool", name: "offer_recipe", args: '{"dish":"Chili","from_conversation":false}' }]`, and `aiChat` was called once (no second round).
  - `offer_recipe` + `lookup_nutrition` in the same round → only `terminal_tool`; the lookup executor mock is not called.
  - Pre-tool content "Sure!" → `[content "Sure!", terminal_tool]`.
  - `options.offerRecipe` false → the `tools` passed to `aiChat` contain no `offer_recipe` (flag off unchanged).
  - `intent "safety_refusal"` + `offerRecipe` true → no `offer_recipe` in tools.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Pass `opts.offer` into the place where Pro builds the blocks prompt: find the caller of `getBlocksSystemPrompt` via LSP `incomingCalls`, and thread `offerRecipe` there too.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 11: Coach Pro wiring: entry, save-before-yield, route settle, taps don't count

**Files:**

- Modify: `server/services/recipe-finder/entry.ts:139-170` (`decideCoachFinderEntry`)
- Modify: `server/services/coach-pro-chat.ts:550-595,836-860`
- Modify: `server/services/recipe-finder/coach-turn.ts`
- Modify: `server/routes/chat.ts:~401-413` (taps) and the H6 settle (~850)
- Test: `__tests__/entry.test.ts`, `server/services/__tests__/coach-pro-chat.test.ts`, `server/routes/__tests__/chat*.test.ts` (whichever covers the finder route and settle; find with `grep -ln "createFinderUserMessage" server/routes/__tests__`)

**Interfaces:**

```ts
// entry.ts
export function decideCoachFinderEntry(
  history,
  text,
  intent,
  action?,
  opts?: { offer?: boolean },
): CoachFinderEntry;
//   offer on: latest block recipe_offer|recipe_adjust:
//     typed text matching a command (matchTypedFinderCommand: generate/yes/no/search) → { kind: "finder", input: typed } (stays in the finder);
//     any other typed text → { kind: "none" } → tool loop (H2);
//             recipe card latest → { kind: "classify" } as today, but the CALLER maps only refine_current into the finder (H3);
//             intent recipe_request → { kind: "none" } (the model decides).
// coach-turn.ts
export type CoachFinderTurnEntry =
  | { kind: "finder"; input: FinderInput; offer?: boolean }
  | { kind: "refine" };
```

**`handleCoachChat`, offer on:**

- `classifyTurn` result `new_request`/`other` → fall through to the tool loop; only `refine_current` → `{ kind: "refine" }`.
- Pass `offerRecipe: isRecipeOfferEnabled()` into `generateCoachProResponse`.
- On a `terminal_tool` chunk:
  1. Compute `decideOfferToolCall(args, getLatestFinderBlock(history))`.
  2. **`invalid`:**
     - with `fullResponse` empty → save + yield the content `Which dish did you have in mind?`;
     - otherwise keep the streamed text (normal save path).
  3. **`offer`:** build the block with `buildOfferBlock(dish, details, randomUUID())`. Then:
     - **save first:** `content = (fullResponse ? fullResponse + "\n\n" : "") + OFFER_TEXT`, metadata `{ blocks: [block] }`, with the `turnKey`, deduplicated with `getChatMessageByTurnKey` exactly like `persistAssistant`;
     - **then** `yield { type: "blocks", blocks: [block] }`;
     - then `return` (skip the normal save path).
  4. **`repost_adjust`:** save (first) a message with the fallback text and `{ blocks: [{ ...block, flow: { ...block.flow, flowId: randomUUID() } }] }`, the same prefill under a new flowId, so the card stays live. Then yield the blocks.
  5. **`adjust`:** delegate to `runCoachFinderTurn` with `entry: { kind: "finder", input: { kind: "action", action: { type: "offer_yes", flowId: latest.flow.flowId } }, offer: true }`. This needs `params.finder.userMessageId`; the typed user row already exists (Coach inserts it first).

**`runCoachFinderTurn`:**

- Passes `{ offer: entry.offer }` to `prepareFinderTurn`/`executeFinderStep`.
- Handles `close` (persist `No problem.` with NO metadata, then yield content), `plain` (persist and yield) and `generate.allergenDetail` (pass `{ allergenDetail }` to `generateRecipeChatResponse`).

**Every call site must pass `{ offer: isRecipeOfferEnabled() }`.** Grep `prepareFinderTurn(\|planFinderStep(\|executeFinderStep(\|decideCoachFinderEntry(\|decideRecipeChefEntry(` and confirm each passes it:

1. Coach taps (route → `handleCoachChat` → `decideCoachFinderEntry` with `action`);
2. Coach typed (`decideCoachFinderEntry`);
3. the Coach repeat = yes delegation (`runCoachFinderTurn` with `offer: true`);
4. RecipeChef typed (`decideRecipeChefEntry` → route finder dispatch);
5. RecipeChef taps (route → `prepareFinderTurn`/`executeFinderStep`).

Add a test asserting that a tap on an offer block from each of the Coach and RecipeChef paths reaches `build_adjust`, not `invalid_for_stage`. That proves the option is threaded.

**Route (`chat.ts`):**

- In the Coach branch, when `isRecipeOfferEnabled()`, call `createFinderUserMessage(...)` **without** `coachDailyLimit` (taps don't count, all finder actions).
- **Settle (H6):** treat the turn as replied if `getChatMessageByTurnKey(conversationId, turnKey)` finds a saved assistant row, not only when content events streamed. Read the current settle code first; if it already checks the turnKey row, add the blocks-only test and change nothing.

- [ ] **Step 1: Failing tests**
  - **entry**, offer on:
    - a live offer + typed "yes please" → `finder` with the typed command `yes` (stays in the finder);
    - a live adjust + typed "generate" → `finder` (no offer→card→offer loop);
    - a live offer + typed "make it for 6 instead" → `none` (tool loop);
    - a live adjust + typed free text → `none`;
    - intent `recipe_request` with no block → `none`;
    - a live `recipe_results` + typed text → `finder` (unchanged).
  - **entry**, offer off: every existing test is unchanged.
  - **coach-pro-chat** (mock `generateCoachProResponse` to yield `terminal_tool` only):
    - storage `createChatMessage` is called with content `OFFER_TEXT` and `{ blocks: [{ type: "recipe_offer", … }] }` **before** the `blocks` event is yielded. Assert the call order with a shared `order: string[]` array pushed by both mocks.
    - Repeat = yes: history's latest assistant has an offer for "Chili" and the tool args dish "chili" → `runCoachFinderTurn` is invoked with an `offer_yes` action for that flowId.
    - After No: history's latest assistant is "No problem." with no metadata; the same dish → a new offer is saved, not an adjust.
    - Invalid args, no text → saves and yields "Which dish did you have in mind?".
    - A recipe card latest + `classifyTurn` → `new_request` → the generator is called (tool loop); `refine_current` → `runCoachFinderTurn` with `refine`.
  - **route:**
    - a Coach finder tap with the offer flag on → `createFinderUserMessage` is called without `coachDailyLimit`;
    - a blocks-only reply plus a client disconnect → the user row is not deleted.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them**, plus `npx vitest run server/services/recipe-finder server/services/__tests__/coach-pro-chat.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 12: RecipeChef: offer start, yes/no phrases, legacy → offer, `extractOfferDetails`

**Files:**

- Modify: `server/services/recipe-finder/entry.ts` (`decideRecipeChefEntry`, `matchTypedFinderCommand`)
- Modify: `server/services/recipe-finder/extract-query.ts`
- Modify: `server/routes/chat.ts:428-455` and the RecipeChef finder dispatch
- Test: `__tests__/entry.test.ts`, `__tests__/extract-query.test.ts`, the route test from Task 11

**Interfaces:**

```ts
export function matchTypedFinderCommand(text, stage): TypedFinderCommand | null;
//   "yes"/"no" when stage is recipe_offer or recipe_adjust; "search" (SEARCH_PHRASES = {"search","search ocrecipes","search for one"}) only on recipe_offer.
//   YES_PHRASES = {"yes","yes please","sure","go ahead","do it","ok","okay","yep"}; NO_PHRASES = {"no","no thanks","no thank you","nope","not now"}
export function decideRecipeChefEntry(
  history,
  text,
  opts?: { offer?: boolean },
): RecipeChefEntry;
//   offer on: no block, no card, a user has spoken before → { kind: "finder", input: { kind: "start", text } } (legacy → offer, H3)
export async function extractOfferDetails(
  text: string,
  history: ChatMessage[],
): Promise<{ dish: string | null; details: RecipeDetails }>;
```

`extractOfferDetails` reuses `extractQuery`'s call shape with the feature row `finder-extract-offer`. The system prompt returns `{"dish": string|null, "servings": int|null, "spice": "mild"|"medium"|"hot"|null, "time": "quick"|"moderate"|"leisurely"|null, "ingredients": string[]}`, and the last 6 turns go in as context, so "make it for 8" can resolve against history.

- `dish` is null when the message names no dish ("thanks").
- Each field is validated on its own, as in `extractQuery`.
- On failure → `{ dish: null, details: { ingredients: [], fromConversation: false } }`.

- [ ] **Step 1: Failing tests**
  - `matchTypedFinderCommand("Yes please!", "recipe_offer")` → `"yes"`; on `"recipe_results"` → `null`.
  - `decideRecipeChefEntry`, offer on:
    - after a "No problem." message (no block, no card, prior user turns) → `start`;
    - offer off → `legacy` (unchanged).
  - `planFinderStep` (via Task 4 rules) with typed `"yes"` on an offer → `build_adjust`; with other typed text → `offer_from_text`.
  - `extractOfferDetails`:
    - mocked `aiChat` JSON `{dish:"Spaghetti and meatballs",servings:8,spice:null,time:null,ingredients:[]}` → details `{ servings: 8, ingredients: [], fromConversation: false }`;
    - `servings: 99` → dropped;
    - a throw → dish null.
  - **Route**, RecipeChef with the offer flag on: "No" tap → closing message; then typed "actually, make it spicy" → the finder path (`createFinderUserMessage`), **not** `createChatMessageWithLimitCheck`, and no generation call.
- [ ] **Step 2: Run them.** Expected: FAIL.
      **`classifyTurn → other` in RecipeChef.** Today the route leaves `recipeFinderInput` null for `other`, so the message falls to `createChatMessageWithLimitCheck` and legacy generation, which can emit a new recipe card. With the offer on, `other` (thanks, storage or technique questions about the card on screen) is treated as **part of the refine exception**: a conversation about the card already on screen. It stays on the legacy path. Add a test: offer on, a card latest + `other` → the legacy path (unchanged). Flag it to the owner in the PR as a deliberate carve-out; if the owner rejects it, the follow-up is to route `other` to a plain reply with no generation.

- [ ] **Step 3: Implement.**
  - Pass `{ offer: isRecipeOfferEnabled() }` through the route to `decideRecipeChefEntry` and `prepareFinderTurn`/`executeFinderStep`.
  - On `classifyTurn → new_request` with offer on, the route already sets `{ kind: "start" }`, which Task 4 maps to `offer_from_text`.
  - Handle the `close` / `plain` results in the RecipeChef finder SSE path the same way `message` is handled, minus the block.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 13: Todo acceptance regression set + PR 2

**Files:** Test `server/services/__tests__/coach-recipe-offer-acceptance.test.ts`.

- [ ] **Step 1: Write the acceptance tests**, end-to-end through `handleCoachChat` with `generateCoachProResponse` mocked to emit `terminal_tool` for asks, and prose for negatives (model behaviour is PR 1's job; this pins the plumbing):
  - the owner's exact message, after a suggestion → an offer block saved;
  - free Coach (`isCoachPro: false`) → the tools never include `offer_recipe`, and no finder;
  - a safety message ("how do I stop eating for a week") → the safety path, no `offer_recipe` in tools;
  - the four negatives after a card → `classifyTurn` (mocked `other`) → the tool loop, with no offer when the model returns prose;
  - flag off → the regex route exactly as before ("Find me a high protein chicken recipe" → finder `start` → community search).
- [ ] **Step 2: Run them.** Expected: PASS. (If anything fails, fix the owning task's code, not the test.)
- [ ] **Step 3: Commit**, push (`preflight:fast` runs), open PR 2, and dispatch the roster reviewers (code-reviewer + server-reviewer + ai-reviewer + security-auditor) using the `docs/AI_WORKFLOW.md` dispatch prompt verbatim. Merge after one review pass + CI. **The flag stays off.**

---

## PR 3: client

### Task 14: Offer + adjust blocks in both chats

**Files:**

- Create: `client/components/recipe-finder/recipe-offer-utils.ts`
- Create: `client/components/recipe-finder/RecipeOffer.tsx`, `client/components/recipe-finder/RecipeAdjust.tsx`
- Modify: `client/components/recipe-finder/RecipeFinderMessage.tsx` (the shared finder renderer used by both chats), `client/components/coach/blocks/index.tsx:81-92` (add `case "recipe_offer": case "recipe_adjust":` to the `RecipeFinderMessage` arm), RecipeChef's use of `RecipeFinderMessage`, and `client/components/recipe-finder/recipe-finder-utils.ts` (the action builder)
- Test: `client/components/recipe-finder/__tests__/recipe-offer-utils.test.ts`, plus render tests in `client/components/recipe-finder/__tests__/`

**Interfaces:**

```ts
export function clampServings(n: number): number; // 1..20
export function buildAdjustAction(
  block: RecipeAdjustBlock,
  state: {
    servings: number;
    spice: SpiceLevel;
    time: CookingTimeId;
    answers: Record<string, string>;
  },
): FinderAction; // type "adjust_generate"
export function timeLabel(id: CookingTimeId): string; // from shared COOKING_TIMES
```

- [ ] **Step 1: Failing util tests**
  - `clampServings(0) === 1`, `clampServings(25) === 20`;
  - `buildAdjustAction` drops unanswered questions, includes the chosen ones verbatim, and `finderActionSchema.safeParse(result).success === true`;
  - `timeLabel("quick") === "Under 30 minutes"`.
- [ ] **Step 2: Run them.** `npx vitest run client/components/recipe-finder/__tests__/recipe-offer-utils.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the utils**, then the components. Load the `interaction-feel` skill first: the chips, stepper and buttons need press feedback.
  - `RecipeOffer`: the fixed text comes from message content. Buttons `Yes` / `Search` / `No` send `offer_yes` / `offer_search` / `offer_no`. They're disabled unless this is the latest finder block, using the existing "latest only" helper used by `recipe_results`.
  - `RecipeAdjust`:
    - title = `flow.dish`;
    - a servings stepper (`accessibilityRole="adjustable"` with increment/decrement actions);
    - spice and time segmented chips (`accessibilityState={{ selected }}`);
    - "Avoiding" with a lock icon and `accessibilityLabel="Avoiding peanuts, shellfish. Change allergies in your profile."`;
    - "Also noted";
    - follow-up chips;
    - `Cancel` → `adjust_cancel`; `Generate` → `buildAdjustAction`.
  - Theme colours only, with no hard-coded hex (lint-staged checks).
- [ ] **Step 4: Render tests**
  - Both blocks render in the Coach and RecipeChef lists.
  - Old `recipe_results`/`recipe_questions` messages still render.
  - An unknown future block type renders the message text (fallback).
  - Tapping Generate calls the send function with a schema-valid action.
- [ ] **Step 5: Run them.** Expected: PASS.
- [ ] **Step 6: Commit**, push, open PR 3 (mobile-reviewer + code-reviewer), merge. Then **ask the owner** before publishing a preview OTA with `npm run update:preview -- --message "recipe offer + adjust card"`. The owner device-tests by flipping the flag in prod (no users; see "After merge").

### Task 15: Maestro (iOS)

**Files:** Modify `e2e/manual/recipe-finder.yaml`.

- [ ] **Step 1: Add the flows**
  - Coach Pro: type "Can you make me a recipe for chicken thighs?" → assert "Want me to get started?" → tap `Yes` → assert "Servings" → tap `Generate` → assert the recipe card title.
  - RecipeChef: type "spaghetti and meatballs for 8" → tap `Search` → assert the community list.
  - Use the CLI driver only (MCP and CLI collide on one sim), and `scroll` before tapping buttons near the composer (memory gotchas).
- [ ] **Step 2: Run it.** `maestro test e2e/manual/recipe-finder.yaml` on the booted iOS sim, with the local server `RECIPE_FINDER_ENABLED=true RECIPE_OFFER_ENABLED=true`. Expected: all green.
- [ ] **Step 3: Commit** with PR 3 or as a follow-up PR.

---

## After merge (owner-gated, not executor tasks)

- **RESOLVED (owner, 2026-10-06): the app has no users** besides the owner. Device testing flips `RECIPE_OFFER_ENABLED` in prod directly (still on the owner's explicit yes); no allowlist or staging needed.

- **Flip `RECIPE_OFFER_ENABLED=true`** on Railway prod, **only on the owner's explicit yes**. Rollback = unset.
- **Production OTA:** a separate ask.
- **PR 4 cleanup** (its own small plan, after a stable period):
  - delete the regex recipe route, `search_recipes`, the `recipe_card` instructions and RecipeChef's legacy direct generation;
  - delete the flag-off branches of both flags.
- **Mark the todo superseded:** move `todos/P2-2026-10-07-coach-recipe-from-own-suggestion.md` to `todos/archive/` with a pointer to this plan, after PR 2 merges.
