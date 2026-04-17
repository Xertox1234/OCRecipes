# AI Prompting Patterns

Patterns for building and maintaining system prompts for AI features (coach, photo analysis, recipe chat, etc.).

### Pre-Compute Numeric Context — Never Make an LLM Do Arithmetic

LLMs (especially smaller models like `gpt-4o-mini`) are unreliable at basic math. When the system prompt includes numeric data the model needs to reason about, compute the answer server-side and inject it directly.

```typescript
// ❌ BAD: Model must subtract 1750 - 1600 = -150 (frequently gets this wrong)
parts.push(`Daily goals: 1600 cal`);
parts.push(`Today's intake: 1750 cal`);

// ✅ GOOD: Model reads the answer directly
parts.push(`Daily goals: 1600 cal`);
parts.push(`Today's intake: 1750 cal`);
parts.push(`Remaining today: OVER by 150 cal, 15g protein needed`);
```

**Impact:** The over-calories eval case went from 2/10 to 9/10 on personalization after this change. The model stopped telling users who exceeded their calorie goal that they had calories "remaining."

**When to use:** Any prompt that includes numeric data the model needs to compare, subtract, or reason about (calorie budgets, macro targets, weight trends, recipe scaling).

**References:**

- `server/services/nutrition-coach.ts` — `buildSystemPrompt()` pre-computes remaining macros

### Few-Shot Examples Beat Instructions

A single example exchange in the system prompt has more impact on response quality than multiple explicit instructions. The model learns the _pattern_ from demonstration better than description.

```typescript
// Instructions alone (model follows inconsistently):
"Calculate remaining macros and reference specific numbers in your response.";

// One example (model follows consistently):
("EXAMPLE EXCHANGE:",
  "User: 'I don't know what to eat for dinner.'",
  "NutriCoach: 'You've got about 600 calories and 40g protein left for today — nice work!",
  "• Grilled chicken breast with roasted vegetables (~450 cal, 35g protein)",
  "• A big salad with chickpeas, feta, and olive oil dressing (~400 cal, 20g protein)",
  "Want me to look up a recipe for either of these?'");
```

**Impact:** Adding this single example improved helpfulness by +0.5 and personalization by +0.9 across the eval suite. The model learned to: calculate remaining macros, suggest foods with approximate macros, and end with a follow-up question.

**When to use:** Any AI feature where you want consistent output format or behavior. Start with 1-2 examples — more than 3 eats into the context window with diminishing returns.

**When NOT to use:** When the desired behavior is simple and instruction-following is reliable (e.g., "respond in JSON format").

### System Prompt Length Affects Completion Budget

`max_completion_tokens` is the budget for the model's _response_, but a longer system prompt means more tokens consumed before the response starts. Adding ~200 tokens of prompt instructions caused response truncation at `max_completion_tokens: 1000`.

**Rule of thumb:** When enriching a system prompt, bump `max_completion_tokens` by at least the number of tokens you added. A 150-word response limit in the prompt prevents bloat even with a higher token ceiling.

**References:**

- `server/services/nutrition-coach.ts` — bumped from 1000 to 1500 after prompt expansion

### Safety Refusals Should Still Use Context

When an AI service declines a dangerous request (extreme dieting, medical diagnosis, etc.), the refusal should still reference the user's data to offer a personalized safe alternative. Generic refusals score poorly on personalization and feel unhelpful.

```
Bad:  "I can't help with a 500 calorie plan. Try a moderate deficit instead."
Good: "A 500 cal/day plan would be unsafe. Your goal is 2000 cal — a moderate
       deficit of ~1600-1700 cal would support steady weight loss at your
       current 90kg. Want me to build a meal plan around that?"
```

**How to implement:** Add a "WHEN DECLINING UNSAFE REQUESTS" section to the system prompt with good/bad examples. The model learns to combine safety with personalization from the contrast.

**Caveat:** Smaller models (gpt-4o-mini) still drop context during safety refusals — this is a model-level limitation. The prompt guidance helps but doesn't fully solve it (safety cases still score 2-3/10 on personalization).

### Restrict Markdown to Chat-Safe Formats

System prompts should specify which markdown is allowed. Headers (`#`), tables, and code blocks render poorly in mobile chat bubbles.

```typescript
// In system prompt:
"Use **bold** and *italic* for emphasis and bullet points for lists.
Do not use headers, tables, or code blocks — they render poorly in chat."
```

**When to use:** Any AI feature whose output renders in a chat UI or mobile component with limited markdown support.

### Zod-Parse LLM Responses; Fail Closed on Invalid Shape

LLMs frequently return JSON that almost-matches the expected schema —
wrong casing on enum values, missing optional fields, extra dimensions.
Using `JSON.parse(...) as ExpectedType` loses the validation and lets
invalid data flow downstream silently.

```typescript
// ❌ Bad: JSON.parse + type assertion; unknown values silently coerce
const parsed = JSON.parse(text) as {
  scores: { dimension: string; score: number; reasoning: string }[];
};
const scores = parsed.scores.map((s) => ({
  dimension: s.dimension.toLowerCase() as RubricDimension, // lies if mismatched
  score: s.score,
  reasoning: s.reasoning,
}));
// Downstream aggregator: if (entry) { ... } silently drops unknown dimensions
```

```typescript
// ✅ Good: Zod safeParse with a dimension-enum refinement
const dimensionSchema = z
  .string()
  .transform((s) => s.toLowerCase())
  .refine((s): s is RubricDimension =>
    (ALL_DIMENSIONS as string[]).includes(s),
  );

const judgeResponseSchema = z.object({
  scores: z.array(
    z.object({
      dimension: dimensionSchema,
      score: z.number().min(1).max(10),
      reasoning: z.string(),
    }),
  ),
  calorie_assertion_passed: z.boolean().optional(),
});

const raw = JSON.parse(cleaned);
const validated = judgeResponseSchema.safeParse(raw);
if (!validated.success) {
  // Fail closed — return a sentinel that signals "not measured" to the
  // aggregator instead of silently dropping data that bypasses validation.
  return {
    scores: dimensions.map((d) => ({
      dimension: d,
      score: 0,
      reasoning: "Judge returned invalid schema — score unavailable",
    })),
  };
}
```

**When to apply:** Any time the LLM's output is structured data consumed
by code (tool-call args, evaluation judges, classification labels,
extracted entities). If the output is free-form text for a user to read,
validation is less critical.

**Fail-closed principle:** For safety-critical assertions (calorie
thresholds, allergen matches), a parsing failure should default to the
_conservative_ answer (score = 0, assertion failed), not pass-by-omission.

**Origin:** 2026-04-17 audit H11 — `evals/judge.ts` was `JSON.parse`-ing
judge output, casting `dimension.toLowerCase()` as `RubricDimension`, and
the aggregator's `if (entry)` guard silently dropped unknown dimensions
— biasing dimension averages because "empathy" or "safety score"
(instead of "safety") were simply missing from the aggregate.

### Version-Anchor LLM Models in Persisted Results

When running evaluations or any LLM pipeline where results will be
compared across time, never rely on a model alias (`claude-sonnet-4-6`
without a dated snapshot) to stay stable. Provider alias rolls silently
shift output quality. Record the exact model string in every persisted
result record.

```typescript
// ❌ Bad: hardcoded alias, result doesn't record which model scored it
const message = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1000,
  messages: [{ role: "user", content: prompt }],
});
// EvalRunResult { runId, totalCases, dimensionAverages }  ← no model record
```

```typescript
// ✅ Good: env-overridable default, recorded per result
export const DEFAULT_JUDGE_MODEL =
  process.env.EVAL_JUDGE_MODEL || "claude-sonnet-4-6";

export async function judgeResponse(params: {
  dimensions: RubricDimension[];
  model?: string;
  // ...
}): Promise<{ scores: RubricScore[]; judgeModel: string }> {
  const judgeModel = params.model ?? DEFAULT_JUDGE_MODEL;
  const message = await client.messages.create({
    model: judgeModel,
    temperature: 0, // deterministic — pin this too
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });
  // ...
  return { scores, judgeModel };
}

// EvalRunResult now includes judgeModel so regression comparisons know
// whether a score shift is a real quality change or a provider alias roll.
export interface EvalRunResult {
  runId: string;
  timestamp: string;
  judgeModel: string;
  // ...
}
```

**When to apply:** Eval judges, benchmark scorers, quality gates, any
comparison-over-time LLM output. For single-use generation (photo
analysis, recipe generation) the alias is acceptable since results aren't
stored for cross-version comparison.

**Also pin:** `temperature: 0` for deterministic scoring; `top_p` if
relevant. Non-zero temperature on a judge adds variance that looks like
model drift.

**Origin:** 2026-04-17 audit H8 — `evals/judge.ts` hardcoded the model
string with no env override and the `EvalRunResult` type didn't record
which model generated the scores. Reproducing yesterday's run after an
Anthropic alias change would produce silently different numbers.
