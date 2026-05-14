---
title: "OpenAI SDK timeout and tiered error handling"
track: knowledge
category: design-patterns
tags: [api, openai, timeout, ai, error-handling]
module: server
applies_to: ["server/services/**/*.ts", "server/lib/openai.ts"]
created: 2026-05-13
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

| Service role                                 | Strategy                                       | Example                                                           |
| -------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| Required data (recipe, menu, meals)          | `try/catch` → re-throw user-friendly message   | `throw new Error("Failed to generate recipe. Please try again.")` |
| Optional / degradable data (food-nlp, photo) | `try/catch` → return fallback                  | `return []` or return previous result                             |
| Streaming (coach)                            | `try/catch` → `yield` error message + `return` | `yield "Sorry, I'm having trouble responding right now."`         |

```typescript
// Required data — re-throw with user-friendly message
let response;
try {
  response = await openai.chat.completions.create(params, { timeout });
} catch (error) {
  console.error("Recipe generation API error:", error);
  throw new Error("Failed to generate recipe. Please try again.");
}

// Degradable data — return fallback
try {
  response = await openai.chat.completions.create(params, { timeout });
} catch (error) {
  console.error("Food NLP parsing error:", error);
  return []; // caller can handle empty result
}
```

## Related Files

- `server/lib/openai.ts` — client configuration and timeout constants
- `server/services/food-nlp.ts` — degradable fallback pattern
- `server/services/nutrition-coach.ts` — streaming error handling pattern
- `server/services/recipe-generation.ts` — required data + DALL-E timeout pattern

## See Also

- [Always guard JSON.parse on LLM output](../conventions/always-guard-json-parse-llm-output-2026-05-13.md)
- [Fetch timeout with AbortSignal for every external API call](../conventions/fetch-timeout-abort-signal-external-apis-2026-05-13.md)
- [SSE AbortController — cancel OpenAI stream on client disconnect](sse-abort-controller-cancel-openai-stream-2026-05-13.md)
