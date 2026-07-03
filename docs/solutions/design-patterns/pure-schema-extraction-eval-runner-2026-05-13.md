---
title: Pure schema extraction for eval-runner testability
track: knowledge
category: design-patterns
module: server
tags: [ai, evals, zod, schemas, side-effects, testability]
applies_to: [evals/lib/dataset-schemas.ts, evals/runner-*.ts]
created: '2026-05-13'
---

# Pure schema extraction for eval-runner testability

## When this applies

Runner files call `runEvalSuite()` at module scope — a side effect that triggers the full eval pipeline on import. This makes Zod schemas defined in the same file impossible to import in unit tests without launching an eval run.

## Why

Vitest imports the test target module. If that module has a top-level `runEvalSuite()` call, importing it starts an eval run (which makes API calls, costs money, and takes minutes). Schemas live separately in a side-effect-free file so unit tests can validate dataset shape without triggering the pipeline.

## Examples

```typescript
// evals/lib/dataset-schemas.ts — no side effects, safe to import in tests
export const recipeChatCasesSchema = z.array(recipeChatCaseSchema);
export type RecipeChatInput = z.infer<typeof recipeChatInputSchema>;

// evals/runner-recipe-chat.ts — has module-level side effects, never import in tests
import { recipeChatCasesSchema } from "./lib/dataset-schemas";
runEvalSuite(validation.data, { ... }); // ← module-level side effect
```

## Rule

Any module that calls a function at top level (outside `export` or class declarations) must not own shared types or schemas. Move the shared items to a sibling file with no top-level calls.

## Related Files

- `evals/lib/dataset-schemas.ts` — pure schema extraction (no side effects)
- `evals/runner-*.ts` — entrypoints with module-level `runEvalSuite()` calls

## See Also

- [LLM evaluation as a separate testing tier](llm-evaluation-separate-testing-tier-2026-05-13.md)
- [Eval dataset validation as unit tests](../best-practices/eval-dataset-validation-as-unit-tests-2026-05-13.md)
