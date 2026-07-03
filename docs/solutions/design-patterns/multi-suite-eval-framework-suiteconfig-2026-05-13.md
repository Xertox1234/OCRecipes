---
title: Multi-suite eval framework via `SuiteConfig` (don't duplicate the runner)
track: knowledge
category: design-patterns
module: server
tags: [ai, evals, llm, framework, suiteconfig]
applies_to: [evals/runner-*.ts, evals/lib/runner-core.ts]
created: '2026-05-13'
---

# Multi-suite eval framework via `SuiteConfig` (don't duplicate the runner)

## When this applies

When extending the eval framework to cover additional AI services, don't duplicate the runner. Add a new `runner-<service>.ts` entrypoint that passes a `SuiteConfig` to `runEvalSuite()` from `evals/lib/runner-core.ts`. The config specifies the rubric text, dimension list, weights, and two callbacks.

## Why

Duplicating the runner per suite triples the surface area for cross-cutting changes (LLM judge upgrade, score-collection refactor, retry policy). A single `runEvalSuite()` with a `SuiteConfig` parameter keeps the shared scaffolding in one file and isolates suite-specific concerns (rubric, dimensions, callbacks) to the entrypoint.

## Examples

```typescript
runEvalSuite(testCases, {
  suiteName: "recipe-generation",
  rubricText: RUBRIC_TEXT,
  dimensions: ["ingredient_coherence", "instruction_clarity", "dietary_compliance", "creativity"],
  dimensionWeights: { dietary_compliance: 2, /* others: 1 */ },
  inputTag: "recipe_request",
  outputTag: "generated_recipe",

  generateResponse: async (testCase) => {
    const i = testCase.input as RecipeGenInput;
    const recipe = await generateRecipeContent({ productName: i.productName, ... });
    return {
      text: serialiseRecipe(recipe),
      structuredData: { ingredients: recipe.ingredients, instructions: recipe.instructions },
      latencyMs: ...,
      wordCount: ...,
    };
  },

  formatInput: (testCase) => {
    const i = testCase.input as RecipeGenInput;
    return `Recipe request: ${i.productName}`;
  },
});
```

The `generateResponse` callback receives the full `EvalTestCase` (not just `testCase.input`) so coach cases (top-level `userMessage`/`context`) and non-coach cases (nested `input`) can coexist in the same runner infrastructure.

## `structuredData` shape contract (critical gotcha)

`runStructuralAssertions(structuredData, assertions)` and the `generateResponse` callback share an implicit data contract — they must agree on the `structuredData` shape. TypeScript types `structuredData` as `unknown` in both, so a mismatch compiles silently and only fails at runtime.

The meal-suggestion runner passes `{ suggestions: [{calories}], remainingCalories }`, so `runStructuralAssertions` checks `d.suggestions.length` for `suggestionCount`. A fixture using a raw array instead of this wrapper object would pass the unit test but fail in production:

```typescript
// ❌ WRONG fixture — test passes but production fails
const data = [{ calories: 400 }, { calories: 350 }, { calories: 500 }];
runStructuralAssertions(data, { suggestionCount: 3 }); // passes (incorrectly)

// ✅ CORRECT fixture — matches what the runner actually passes
const data = {
  suggestions: [{ calories: 400 }, { calories: 350 }, { calories: 500 }],
  remainingCalories: 600,
};
runStructuralAssertions(data, { suggestionCount: 3 }); // correct
```

**Rule:** Always write fixture shapes that are exact copies of the object the production runner's `generateResponse` callback returns, not simplified stand-ins. When adding a new structural assertion, check both the runner's `structuredData` construction and the assertion's duck-typing check to confirm they use the same property path.

## `wordLimitWarning` per suite

Coach default is 150 words (`DEFAULT_WORD_LIMIT_WARNING`). Recipe suites must set `wordLimitWarning: 300` in their `SuiteConfig` — ingredient lists plus numbered instructions legitimately exceed 150 words. Without this, every recipe response triggers a false positive warning that trains reviewers to ignore the signal.

## Related Files

- `evals/lib/runner-core.ts` — `SuiteConfig`, `runEvalSuite`
- `evals/runner-meal-suggestions.ts`, `evals/runner-recipe-chat.ts`, `evals/runner-recipe-generation.ts`, `evals/runner-photo-analysis.ts` — multi-suite entrypoints

## See Also

- [LLM evaluation as a separate testing tier](llm-evaluation-separate-testing-tier-2026-05-13.md)
- [Promise.allSettled for resilient batch LLM eval runs](promise-allsettled-resilient-batch-llm-2026-05-13.md)
- [Pure schema extraction for eval-runner testability](pure-schema-extraction-eval-runner-2026-05-13.md)
