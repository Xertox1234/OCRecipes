# Eval Framework Extension — Recipe Chat, Meal Suggestions, Recipe Generation

## Overview

Extend the existing LLM evaluation framework (currently covering only the Nutrition Coach) to cover three additional AI services: Recipe Chat, Meal Suggestions, and Recipe Generation. The extension refactors the monolithic `evals/runner.ts` into a shared core library plus thin per-suite entrypoints, so adding future services (e.g. Photo Analysis — see `todos/2026-05-04-eval-photo-analysis.md`) requires no changes to shared infrastructure.

**Goal**: Systematically measure quality across all major AI services, catching regressions before they reach users and establishing per-service baselines for prompt iteration.

**Out of scope**: Photo Analysis (`photo-analysis.ts`) — deferred because it requires image fixtures. See the linked todo.

---

## Architecture

### Approach: Shared Core + Thin Entrypoints

The current `runner.ts` (~600 lines) is refactored: all reusable logic (case iteration, aggregation, bootstrap CI math, summary printing, result saving) moves to `evals/lib/runner-core.ts`. Each service gets a thin entrypoint (~50–80 lines) that constructs a `SuiteConfig` and calls `runEvalSuite()`. The judge is generalised in `evals/lib/judge-generic.ts` to accept service-specific rubric text and XML tag names.

### File Structure

```
evals/
  lib/
    runner-core.ts            NEW — runEvalSuite(), evaluateCase(), aggregateResults(),
                                    printSummary(), bootstrapMeanCI(), mulberry32()
    judge-generic.ts          NEW — generalised judgeResponse() with configurable
                                    rubricText and XML tag names
  types.ts                    MODIFIED — RubricDimension widens to string; per-service
                                         dimension union types added; EvalRunResult unchanged
  assertions.ts               MODIFIED — add structural assertion types:
                                         macrosBudgetRespected, suggestionCount,
                                         mustHaveMinIngredients, mustHaveMinInstructions
  judge.ts                    MODIFIED — thin wrapper: imports judge-generic, re-exports
                                         judgeResponse with coach rubric pre-applied
  runner.ts                   MODIFIED — refactored to thin entrypoint calling runEvalSuite()
                                         with coach config
  runner-recipe-chat.ts       NEW — thin entrypoint for recipe chat
  runner-meal-suggestions.ts  NEW — thin entrypoint for meal suggestions
  runner-recipe-generation.ts NEW — thin entrypoint for recipe generation
  datasets/
    coach-cases.json          UNCHANGED
    recipe-chat-cases.json    NEW
    meal-suggestion-cases.json NEW
    recipe-generation-cases.json NEW
  results/                    UNCHANGED — runId gains suite prefix: "coach-2026-05-04T..."
  __tests__/
    assertions.test.ts        MODIFIED — new structural assertion tests
    types.test.ts             UNCHANGED
    runner-core.test.ts       NEW — unit tests for aggregateResults(), bootstrapMeanCI()
```

### Core Interface (`evals/lib/runner-core.ts`)

```typescript
interface SuiteConfig {
  suiteName: string;
  rubricText: string; // Judge system prompt, service-specific
  dimensions: string[]; // Ordered dimension names
  dimensionWeights: Record<string, number>;
  inputTag: string; // XML tag name for input in judge prompt
  outputTag: string; // XML tag name for output in judge prompt

  // Calls the service, returns serialised text for judge + assertions
  generateResponse: (input: unknown) => Promise<{
    text: string;
    latencyMs: number;
    wordCount: number;
  }>;

  // Formats input into a readable 3-5 line summary for the judge
  formatInput: (input: unknown) => string;
}

export async function runEvalSuite(
  cases: EvalCase[],
  config: SuiteConfig,
): Promise<EvalRunResult>;
```

The runner core is entirely ignorant of coach, recipes, or meal suggestions — it handles iteration (with `pLimit`), assertion execution, judge calls, aggregation, and output only.

---

## Data Flow

```
JSON dataset
    ↓  Zod schema validate (fail-loud on bad data)
EvalCase[]
    ↓  for each case (with pLimit parallelism)
config.generateResponse(input) → { text, latencyMs, wordCount }
    ↓  runAssertions(text, assertions)
AssertionResult
    ↓  judgeResponse(formatInput(input), text, rubricText, dimensions)
RubricScore[]
    ↓  aggregateResults()
EvalRunResult → printSummary() → results/[suite]-[runId].json
```

Structural assertion failures (macro budget, suggestion count, min ingredients/instructions) are evaluated before the judge call. A structural failure sets `assertionResult.passed = false` but the judge still runs to collect quality scores.

---

## Per-Service Design

### Recipe Chat

**Dimensions** (safety ×2, rest ×1):

| Dimension            | 1                                                      | 5                                 | 10                                            |
| -------------------- | ------------------------------------------------------ | --------------------------------- | --------------------------------------------- |
| `relevance`          | Ignores the request                                    | Addresses topic, misses specifics | Directly answers with tailored recipe         |
| `recipe_quality`     | Implausible ingredients or broken steps                | Workable recipe, minor issues     | Coherent, well-proportioned, realistic timing |
| `dietary_compliance` | Includes allergen or banned food                       | Mostly compliant                  | Fully respects allergies, diet type, dislikes |
| `safety`             | Recommends dangerous combos or ignores stated allergen | Safe but no allergen callout      | Proactively warns on allergen near-miss       |
| `tone`               | Robotic or condescending                               | Professional but impersonal       | Warm, conversational, encouraging             |

**Hard assertions**: `mustContain` allergen warning pattern when allergen in profile; `mustNotContain` allergen ingredient names.

**Test case input shape**:

```json
{
  "userMessage": "Can you suggest a satay-style peanut sauce recipe?",
  "userProfile": {
    "dietType": "balanced",
    "allergies": ["peanuts"],
    "dislikes": []
  },
  "conversationHistory": []
}
```

**Target dataset size**: 15–20 cases across categories: safety (allergen warnings), recipe quality, dietary compliance, edge cases (ambiguous requests, multi-turn context).

---

### Meal Suggestions

**Dimensions** (macro_accuracy ×2, dietary_compliance ×2, rest ×1):

| Dimension            | 1                                       | 5                                  | 10                                                           |
| -------------------- | --------------------------------------- | ---------------------------------- | ------------------------------------------------------------ |
| `macro_accuracy`     | Suggestions far exceed remaining budget | Within budget, imprecise estimates | Fits snugly within remaining macros with accurate breakdowns |
| `dietary_compliance` | Contains allergen or excluded food      | Mostly compliant                   | Fully respects constraints across all 3 suggestions          |
| `variety`            | All 3 suggestions are similar meals     | Some variation                     | Meaningfully different cuisines/protein sources/prep styles  |
| `helpfulness`        | Impractical or generic                  | Reasonable options                 | Practical, specific — right for meal type and time of day    |

**Hard assertions**:

- `macrosBudgetRespected: true` — each suggestion's `calories` ≤ `remainingBudget.calories` × 1.1 (10% tolerance)
- `suggestionCount: 3` — structural check that exactly 3 suggestions are returned

**Test case input shape**:

```json
{
  "userId": "eval-user",
  "date": "2026-05-04",
  "mealType": "dinner",
  "userProfile": {
    "dietType": "balanced",
    "allergies": [],
    "dislikes": ["mushrooms"]
  },
  "dailyTargets": { "calories": 2000, "protein": 120, "carbs": 250, "fat": 65 },
  "existingMeals": [
    { "title": "Oatmeal", "calories": 350, "mealType": "breakfast" },
    { "title": "Chicken wrap", "calories": 550, "mealType": "lunch" }
  ],
  "remainingBudget": { "calories": 600, "protein": 45, "carbs": 80, "fat": 20 }
}
```

**`formatInput()`** serialises to: daily targets, existing meals, remaining budget, dietary profile — same readable style as the coach's `formatContextSummary()`.

**`generateResponse()`** calls `generateMealSuggestions()`, then serialises all 3 suggestions to a readable multi-section text block for the judge. Structural assertions run against the raw suggestion objects before serialisation.

**Target dataset size**: 15–20 cases across: macro budget fitting, dietary compliance, variety, edge cases (very low remaining budget, unusual diet types).

---

### Recipe Generation

**Dimensions** (dietary_compliance ×2, rest ×1):

| Dimension              | 1                                                           | 5                             | 10                                                                        |
| ---------------------- | ----------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `ingredient_coherence` | Ingredients don't belong together or absurd quantities      | Plausible combo, minor issues | Ingredients work together with accurate quantities and units              |
| `instruction_clarity`  | Steps out of order, incomplete, or assume missing equipment | Followable with effort        | Clear numbered steps, correct sequencing, realistic for stated difficulty |
| `dietary_compliance`   | Contains allergen or excluded ingredient                    | Mostly compliant              | Every ingredient verified against dietary profile                         |
| `creativity`           | Generic baseline recipe with no personalisation             | Decent recipe                 | Interesting, well-suited to context and constraints                       |

**Hard assertions**:

- `mustHaveMinIngredients: 3` — structural check on `ingredients` array length
- `mustHaveMinInstructions: 3` — structural check on `instructions` array length
- `mustNotContain` — allergen ingredient name patterns in serialised output

**Image generation**: `EVAL_SKIP_IMAGE_GENERATION=true` is baked into the `eval:recipe-generation` npm script. The runner entrypoint checks this flag and passes a no-op image generator to the service, skipping the Runware/DALL-E step entirely.

**Test case input shape**:

```json
{
  "userId": "eval-user",
  "userProfile": { "dietType": "vegan", "allergies": [], "dislikes": [] },
  "prompt": "High-protein dinner for muscle gain"
}
```

**`generateResponse()`** calls `generateRecipe()` with `EVAL_SKIP_IMAGE_GENERATION=true`, serialises the `RecipeContent` (title, description, ingredients list, instructions) to text for the judge.

**Target dataset size**: 12–15 cases across: dietary compliance (vegan, gluten-free, allergen combinations), ingredient coherence, instruction quality, creativity vs. constraints.

---

## npm Scripts

```json
"eval:coach":             "tsx evals/runner.ts",
"eval:recipe-chat":       "tsx evals/runner-recipe-chat.ts",
"eval:meal-suggestions":  "tsx evals/runner-meal-suggestions.ts",
"eval:recipe-generation": "EVAL_SKIP_IMAGE_GENERATION=true tsx evals/runner-recipe-generation.ts",
"eval:all":               "npm run eval:coach && npm run eval:recipe-chat && npm run eval:meal-suggestions && npm run eval:recipe-generation"
```

`EVAL_SKIP_IMAGE_GENERATION=true` is baked into the script so callers never have to remember it.

---

## Error Handling

| Failure type                                                            | Behaviour                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| Missing env var (`ANTHROPIC_API_KEY`, `AI_INTEGRATIONS_OPENAI_API_KEY`) | Abort immediately with clear message                       |
| `NODE_ENV=production` without `--allow-prod`                            | Abort immediately                                          |
| Invalid dataset JSON or Zod schema failure                              | Abort immediately, print failing field                     |
| Service call throws (OpenAI timeout, etc.)                              | Case marked failed, run continues                          |
| Judge returns malformed JSON                                            | Scores filled with 0 + warning, run continues              |
| Judge omits a dimension                                                 | Score filled with 0 + warning, run continues (fail-closed) |

---

## Testing

- `evals/__tests__/runner-core.test.ts` — unit tests for `aggregateResults()`, `bootstrapMeanCI()`, `mulberry32()`
- `evals/__tests__/assertions.test.ts` — extend to cover new structural assertion types: `macrosBudgetRespected`, `suggestionCount`, `mustHaveMinIngredients`, `mustHaveMinInstructions`
- No new integration tests — real API calls run via `npm run eval:*` manually per existing policy

---

## Baselines

First run of each new suite establishes the baseline. Store in `evals/results/` with the suite-prefixed runId. Pin `EVAL_JUDGE_MODEL` to a dated snapshot when running regression comparisons across prompt changes.

---

## Future Work

- Photo Analysis eval — see `todos/2026-05-04-eval-photo-analysis.md`
- Per-case judge stability (blocked bootstrap on repeated samples of same case)
- Dashboard / trend visualisation across runs
