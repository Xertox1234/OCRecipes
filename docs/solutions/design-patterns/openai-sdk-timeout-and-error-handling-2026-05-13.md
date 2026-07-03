---
title: OpenAI SDK timeout and tiered error handling
track: knowledge
category: design-patterns
module: server
tags: [api, openai, timeout, ai, error-handling]
applies_to: [server/services/**/*.ts, server/lib/openai.ts]
created: '2026-05-13'
last_updated: '2026-05-28'
---

# OpenAI SDK timeout and tiered error handling

## When this applies

Every `openai.chat.completions.create()` or `dalleClient.images.generate()` call. The OpenAI SDK uses a different timeout mechanism than `fetch()` — pass `{ timeout: ms }` as the second argument. Timeouts are tiered by call complexity, with named constants centralized in `server/lib/openai.ts`.

## Why

A single OpenAI timeout doesn't fit every call. A fast NLP parse should fail within 15s; a recipe with a 4000-token budget needs 60s; DALL-E images can take 2 minutes. Centralizing the constants prevents copy-pasted magic numbers and lets you re-tune all callers at once.

## Examples

```typescript
// server/lib/openai.ts — centralized timeout constants
const OPENAI_DEFAULT_TIMEOUT_MS = 45_000; // client-level default

export const OPENAI_TIMEOUT_FAST_MS = 15_000; // simple text parsing (food-nlp)
export const OPENAI_TIMEOUT_STREAM_MS = 30_000; // streaming chat (nutrition-coach)
export const OPENAI_TIMEOUT_HEAVY_MS = 60_000; // large token budgets (recipes, meal suggestions)
export const OPENAI_TIMEOUT_IMAGE_MS = 120_000; // DALL-E image generation

export const openai = new OpenAI({
  apiKey: apiKey ?? "",
  timeout: OPENAI_DEFAULT_TIMEOUT_MS, // client-level default
});
```

Per-request overrides use the second argument:

```typescript
import { openai, OPENAI_TIMEOUT_FAST_MS } from "../lib/openai";

const response = await openai.chat.completions.create(
  { model: "gpt-4o-mini", messages, max_completion_tokens: 500 },
  { timeout: OPENAI_TIMEOUT_FAST_MS }, // override client default
);
```

## Error handling strategy varies by service role

| Service role                                                  | Strategy                                       | Example                                                           |
| ------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Required data (recipe, menu, meals, **photo/label/food-nlp**) | `try/catch` → re-throw user-friendly message   | `throw new Error("Failed to generate recipe. Please try again.")` |
| Refinement of an already-good result (`refineAnalysis`)       | `try/catch` → return the previous result       | `return previousResult` (the prior answer is still valid)         |
| Streaming (coach)                                             | `try/catch` → `yield` error message + `return` | `yield "Sorry, I'm having trouble responding right now."`         |

> **2026-05-28 reclassification (silent-failures audit cluster 1).** The
> photo/label/recipe/front-label/food-nlp services were previously listed as
> "degradable → return fallback (`return []`)." That was wrong: a
> structurally-valid **empty** result (`foods: []`, all-null label,
> `contentType: "non_food"`) is **indistinguishable** from a genuine "no food /
> unreadable" result, so the route shipped a misleading **200** on a real
> OpenAI/Zod failure — in one case telling the user a real food photo "isn't
> food." These are **required data**: throw on failure so the route's
> `handleRouteError` returns a retryable 5xx. The only legitimate fallback is
> `refineAnalysis`, which returns the previous (still-valid) analysis. A genuine
> empty-but-**valid** AI result (the model successfully returned `{ items: [] }`
> for "uhh") still returns the empty array — it is success, not failure.

### Canonical four-guard shape (required data)

Narrow the `try/catch` to the **SDK call only**, then guard the response
extraction separately. A bare `JSON.parse(content || "{}")` placed _outside_ the
catch is a latent crash: a non-throwing-but-malformed response throws an
uncaught `SyntaxError`/`TypeError` instead of a clean retryable error. Precedent:
`receipt-analysis.ts` / `menu-analysis.ts`.

```typescript
// 1. SDK call in its own try/catch
let response;
try {
  response = await openai.chat.completions.create(params, { timeout });
} catch (error) {
  log.error({ err: toError(error) }, "recipe generation API error");
  throw new Error("Failed to generate recipe. Please try again.");
}

// 2. Guard empty content
const content = response.choices[0]?.message?.content;
if (!content) {
  throw new Error("No response from recipe generation");
}

// 3. Guard JSON.parse separately
let rawJson;
try {
  rawJson = JSON.parse(content);
} catch {
  throw new Error("Recipe generation returned invalid data. Please try again.");
}

// 4. Throw on Zod failure
const parsed = recipeSchema.safeParse(rawJson);
if (!parsed.success) {
  log.warn({ zodErrors: parsed.error.flatten() }, "recipe validation failed");
  throw new Error("Recipe generation returned unexpected data.");
}
```

## Related Files

- `server/lib/openai.ts` — client configuration and timeout constants
- `server/services/receipt-analysis.ts`, `server/services/menu-analysis.ts` — canonical four-guard throw pattern
- `server/services/photo-analysis.ts`, `server/services/food-nlp.ts`, `server/services/front-label-analysis.ts` — required-data throw pattern (reclassified 2026-05-28); `refineAnalysis` is the lone return-previous-result fallback
- `server/services/nutrition-coach.ts` — streaming error handling pattern
- `server/services/recipe-generation.ts` — required data + DALL-E timeout pattern

## See Also

- [Always guard JSON.parse on LLM output](../conventions/always-guard-json-parse-llm-output-2026-05-13.md)
- [Fetch timeout with AbortSignal for every external API call](../conventions/fetch-timeout-abort-signal-external-apis-2026-05-13.md)
- [SSE AbortController — cancel OpenAI stream on client disconnect](sse-abort-controller-cancel-openai-stream-2026-05-13.md)
