---
title: Exhaustive-partition lock via shared-type enum
track: knowledge
category: design-patterns
module: shared
tags: [testing, vitest, typescript, enums, drift-detection]
applies_to: ['**/__tests__/**/*.ts']
created: '2026-05-13'
---

# Exhaustive-partition lock via shared-type enum

## When this applies

When a function **intentionally** handles only a subset of a shared union type's values, the gap can silently widen as new values are added to the type. Lock the intentional partition with a test that fails if a newly-added enum value is not categorized — forcing the author to make an explicit "covered" vs "not inferred" decision.

## Why

The TypeScript exhaustiveness checker (`assertNever`) covers the "I must handle every case" scenario, but not the complementary "I intentionally handle only some cases" scenario. Without a partition test, a new enum value silently falls into the unhandled bucket without review.

## Examples

The source file documents the split in a JSDoc comment, and the test enumerates both sides against the shared type:

```typescript
// client/lib/recipe-tag-inference.ts — document the partition
/**
 * Infer diet tags from an ingredient list.
 *
 * Coverage of `DIET_TAG_OPTIONS`:
 *
 *   Covered by ingredient heuristics:
 *     - Vegetarian, Vegan, Gluten Free, Dairy Free
 *
 *   Intentionally NOT inferred (require per-serving macronutrient data):
 *     - Keto, Paleo, Low Carb, High Protein
 *
 * We prefer to surface no suggestion over a wrong one.
 */
export function inferDietTags(ingredientNames: string[]): DietTag[] {
  /* ... */
}
```

```typescript
// client/lib/__tests__/recipe-tag-inference.test.ts — lock the partition
describe("inferDietTags — DIET_TAG_OPTIONS coverage", () => {
  const COVERED: readonly (typeof DIET_TAG_OPTIONS)[number][] = [
    "Vegetarian",
    "Vegan",
    "Gluten Free",
    "Dairy Free",
  ];

  // Intentionally NOT inferred — require macronutrient data.
  const NOT_INFERRED: readonly (typeof DIET_TAG_OPTIONS)[number][] = [
    "Keto",
    "Paleo",
    "Low Carb",
    "High Protein",
  ];

  it("DIET_TAG_OPTIONS is exhaustively partitioned", () => {
    const partitioned = new Set([...COVERED, ...NOT_INFERRED]);
    expect(partitioned.size).toBe(DIET_TAG_OPTIONS.length);
    for (const tag of DIET_TAG_OPTIONS) {
      expect(partitioned.has(tag)).toBe(true);
    }
  });

  // Per-tag assertions follow — one positive test per COVERED tag, one
  // "never emitted" parameterized test for the NOT_INFERRED side.
  for (const tag of NOT_INFERRED) {
    it(`never emits "${tag}" from any sample ingredient list`, () => {
      const samples: string[][] = [
        ["chicken", "avocado", "olive oil"],
        ["beef", "lettuce", "cheese"],
        ["rice", "beans", "tomato"],
      ];
      for (const sample of samples) {
        expect(inferDietTags(sample)).not.toContain(tag);
      }
    });
  }
});
```

## Why both sides

Listing only `COVERED` would let a new enum value silently fall into the "not inferred" bucket without review. Listing both, unioned against the shared type, fails the test if anyone adds a value without categorizing it.

## Checklist

1. Does the function branch on **some but not all** values of a shared type?
2. Is there a documented reason the excluded values are excluded?
3. Would a new enum value silently fall into the wrong bucket if nobody updated the logic?

If all three, add an exhaustive-partition test.

## When to use

Any intentional enum-subset behavior where the shared type lives elsewhere and future developers may add values without finding this site. Candidates: subscription tiers that gate specific features, meal types with different AI prompts, API rate-limit tiers, onboarding screen orderings.

## Exceptions

Functions that genuinely handle every value of the type (use TypeScript's `assertNever` exhaustive-switch pattern instead — the compiler enforces it, no test needed).

## Related Files

- `client/lib/recipe-tag-inference.ts:228-248` — partition documented in JSDoc on `inferDietTags`
- `client/lib/__tests__/recipe-tag-inference.test.ts:87-173` — `DIET_TAG_OPTIONS coverage` suite

## See Also

- [Drift-detection test for empirically-derived constants](drift-detection-test-empirical-constants-2026-05-13.md)
