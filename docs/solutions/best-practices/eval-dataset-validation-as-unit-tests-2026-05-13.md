---
title: Validate eval JSON datasets as unit tests (plus dimension-drift smoke tests)
track: knowledge
category: best-practices
module: server
tags: [ai, evals, vitest, zod, dataset-validation, drift-detection]
applies_to: [evals/__tests__/**/*.ts]
created: '2026-05-13'
---

# Validate eval JSON datasets as unit tests (plus dimension-drift smoke tests)

## When this applies

JSON datasets must be validated against their schemas in the normal Vitest suite — not just at eval runtime. This catches malformed test-case data before it reaches the LLM and produces nonsense scores.

## Why

Dataset validation at eval-runtime fails late (after API spend) and surfaces only the first error. A Vitest-level validation runs in milliseconds, gates every commit, and surfaces ALL malformed cases at once. Pair with dimension-drift smoke tests so the runner's hardcoded dimension list and the suite Zod enum can't desync.

## Examples

### Dataset validation

```typescript
// evals/__tests__/dataset-validation.test.ts
import type { ZodTypeAny } from "zod";

function assertDataset(schema: ZodTypeAny, filename: string): void {
  const data = JSON.parse(
    fs.readFileSync(path.join(datasetsDir, filename), "utf8"),
  );
  const result = schema.safeParse(data);
  if (!result.success) {
    // Surface ALL errors, not just errors[0]
    const msgs = result
      .error!.errors.map(
        (e) => `  ${e.path.join(".") || "(root)"}: ${e.message}`,
      )
      .join("\n");
    throw new Error(`${filename} failed schema validation:\n${msgs}`);
  }
  expect((result.data as unknown[]).length).toBeGreaterThan(0);
}

it("validates coach-cases.json", () =>
  assertDataset(evalTestCasesSchema, "coach-cases.json"));
it("validates recipe-chat-cases.json", () =>
  assertDataset(recipeChatCasesSchema, "recipe-chat-cases.json"));
```

Use `ZodTypeAny` (not a hand-rolled interface) as the schema parameter type. Surfacing all errors matters: a dataset with 3 bad cases would previously show only the first failure, obscuring the full scope of the problem.

### Dimension drift smoke tests

`SuiteConfig.dimensions` (an array of strings) and the `scoreDimensions` Zod enum in the suite's schema must stay aligned — if one adds a dimension the other doesn't know about, averages are silently miscalculated. TypeScript can't catch this because both sides use `string`.

**Fix:** Use `.unwrap().element.options` to introspect the Zod enum at test time and compare against the runner's hardcoded list:

```typescript
it("recipe-chat scoreDimensions enum matches runner config.dimensions", () => {
  const expected = [
    "relevance",
    "recipe_quality",
    "dietary_compliance",
    "safety",
    "tone",
  ];
  // .unwrap() strips the .optional() wrapper; .element.options reads the z.enum() values
  const schemaOptions =
    recipeChatCaseSchema.shape.scoreDimensions.unwrap().element.options;
  expect([...schemaOptions].sort()).toEqual([...expected].sort());
});
```

**Caveat:** `.unwrap()` strips exactly one optionality layer. If the field ever becomes `.nullable().optional()`, the accessor chain breaks loudly (correct — it forces an update). Works for `z.array(z.enum([...])).optional()` shapes.

### Category enum completeness

Suite-specific schemas (`recipeChatCaseSchema`, `mealSuggestionCaseSchema`, etc.) define their own `category` Zod enum. When `"creativity"` (or any future category) is added to the top-level `EvalTestCase["category"]` union, it must also be added to every suite-specific schema. The type system can't catch the omission because the union is widened to `string` for generic runner use. Rule: whenever `types.ts` gains a new category, grep `dataset-schemas.ts` and add it to all per-suite enums.

## Related Files

- `evals/__tests__/dataset-validation.test.ts` — dataset validation + dimension drift smoke tests
- `evals/lib/dataset-schemas.ts` — per-suite Zod schemas
- `evals/lib/runner-core.ts` — `SuiteConfig.dimensions` list

## See Also

- [Multi-suite eval framework via `SuiteConfig`](../design-patterns/multi-suite-eval-framework-suiteconfig-2026-05-13.md)
- [Pure schema extraction for eval-runner testability](../design-patterns/pure-schema-extraction-eval-runner-2026-05-13.md)
