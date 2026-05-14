---
title: "Always guard JSON.parse on LLM output"
track: knowledge
category: conventions
tags: [api, ai, openai, json, error-handling]
module: server
applies_to: ["server/services/**/*.ts"]
created: 2026-05-13
---

# Always guard JSON.parse on LLM output

## Rule

Every `JSON.parse()` on content from `response.choices[0]?.message?.content` must be wrapped in `try/catch`, even when using `response_format: { type: "json_object" }`. This applies even after checking `if (!content) return` — non-null content can still be invalid JSON.

## Why

LLM responses can contain malformed JSON (truncated output hitting token limits, hallucinated syntax, partial responses from timeouts). External REST APIs return malformed JSON extremely rarely — LLMs produce it more frequently because `response_format: { type: "json_object" }` only guarantees _attempted_ JSON. The output can still be truncated if it hits `max_completion_tokens`, or the model may produce syntactically broken JSON in edge cases.

## Examples

```typescript
// Bad — unguarded JSON.parse on LLM output
const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");

// Good — guarded with appropriate fallback
let parsed;
try {
  parsed = JSON.parse(content);
} catch {
  // For required data: throw user-friendly error
  throw new Error("Menu analysis returned invalid data. Please try again.");
  // For optional data: return fallback
  // console.error("Food NLP: AI returned invalid JSON");
  // return [];
}
```

## Related Files

- `server/services/menu-analysis.ts` — guarded JSON.parse with user-friendly error
- `server/services/food-nlp.ts` — guarded JSON.parse with empty-array fallback
- `server/services/meal-suggestions.ts` — guarded JSON.parse (already correct before audit)
- `server/services/recipe-generation.ts` — guarded JSON.parse (already correct before audit)

## See Also

- [OpenAI SDK timeout and tiered error handling](../design-patterns/openai-sdk-timeout-and-error-handling-2026-05-13.md)
- [Zod union + transform for LLM output flexibility](../design-patterns/zod-union-transform-llm-output-2026-05-13.md)
