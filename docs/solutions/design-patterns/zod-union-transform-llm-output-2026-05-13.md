---
title: Zod union + transform + pipe for LLM output flexibility
track: knowledge
category: design-patterns
module: server
tags: [api, ai, zod, validation, normalization]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Zod union + transform + pipe for LLM output flexibility

## When this applies

Parsing LLM JSON responses where the prompt asks for a specific type but the model sometimes returns a different-but-coercible type (string vs array, number vs string-encoded number). Use `z.union` with `.transform` to normalize the shape, then `.pipe` to validate the final type.

## Why

LLM output is inherently unpredictable — even with `response_format: { type: "json_object" }`, the structure of individual fields can vary between calls. The `union` + `transform` + `pipe` chain handles this at the validation layer without requiring prompt engineering workarounds. The `.pipe()` step ensures the transformed value still passes final validation (e.g., `min(1)` catches empty arrays that would transform to `""`).

## Examples

```typescript
// server/services/recipe-generation.ts

const recipeContentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  timeEstimate: z.string().min(1).max(50),
  // LLMs sometimes return instructions as ["Step 1...", "Step 2..."]
  // instead of a single string. Accept both, normalize to string.
  instructions: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v.join("\n") : v))
    .pipe(z.string().min(1)),
  dietTags: z.array(z.string()).default([]),
});

// Usage with safeParse — guard JSON.parse per the always-guard-json-parse-llm-output rule
const content = response.choices[0]?.message?.content || "{}";
let rawParsed: unknown;
try {
  rawParsed = JSON.parse(content);
} catch (err) {
  throw new Error("LLM returned malformed JSON", { cause: err });
}
const parsed = recipeContentSchema.safeParse(rawParsed);

if (!parsed.success) {
  console.error("Recipe generation validation failed:", parsed.error);
  throw new Error("Failed to generate valid recipe content");
}

return parsed.data; // instructions is always a string
```

## Exceptions

Deterministic APIs with stable schemas. Use plain Zod schemas or `z.coerce` for simple type coercion (e.g., `z.coerce.number()` for string-to-number).

## See Also

- [Always guard JSON.parse on LLM output](../conventions/always-guard-json-parse-llm-output-2026-05-13.md)
- [Zod safeParse for external API responses](../conventions/zod-safeparse-external-api-responses-2026-05-13.md)
