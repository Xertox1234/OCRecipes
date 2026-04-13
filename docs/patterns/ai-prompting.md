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
