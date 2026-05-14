---
title: "Eval dataset field forwarding: every schema field must be threaded or marked metadata"
track: knowledge
category: conventions
tags: [ai, evals, zod, dataset-schemas, runner, forwarding]
module: server
applies_to: ["evals/lib/dataset-schemas.ts", "evals/runner-*.ts"]
created: 2026-05-13
---

# Eval dataset field forwarding: every schema field must be threaded or marked metadata

## Rule

Adding a field to the eval Zod schema (in `evals/lib/dataset-schemas.ts`) makes it valid in the JSON and available on `testCase.input` — but nothing passes it to the service unless `generateResponse` in the runner explicitly includes it in the service call. The schema and the runner's `generateResponse` are two separate surfaces; a mismatch compiles cleanly and fails silently at eval time.

## Examples

```typescript
// ❌ WRONG — field is in schema and dataset but never reaches the service
const serviceInput: MealSuggestionInput = {
  dailyTargets: i.dailyTargets,
  remainingBudget: i.remainingBudget,
  // macroGapSignal: i.macroGapSignal  ← missing — eval case tests nothing
};

// ✅ CORRECT — field threaded through OR explicitly documented as metadata
const serviceInput: MealSuggestionInput = {
  dailyTargets: i.dailyTargets,
  remainingBudget: i.remainingBudget,
  dismissedRecipeTitles: i.dismissedTitles, // forwarded: exercised by the service
};
```

**Rule:** When adding a new eval dataset field, decide immediately: (a) forward it in `generateResponse`, or (b) add a comment in the schema explaining it is metadata only. No third option.

## Don't add eval fields for service-internal inferred signals

If the service already computes a value from inputs it already receives, adding a separate eval field for that computed value is YAGNI and actively misleads contributors into thinking the field needs forwarding. Calibrate the existing budget/target numbers to trigger the threshold instead.

```typescript
// server/lib/macro-gap-context.ts — derives gap from dailyTargets and remainingBudget
// Triggers if (target - remaining) / target > 0.30
export function buildMacroGapEmphasis(targets, remaining): string { ... }

// ❌ WRONG — redundant eval field; recomputable from the budget numbers
"input": {
  "remainingBudget": { "protein": 40 },
  "dailyTargets": { "protein": 160 },
  "macroGapSignal": { "macro": "protein", "shortAmount": 120 }  // ← 160-40=120, already implied
}

// ✅ CORRECT — budget numbers calibrated to cross the threshold; no redundant field
"input": {
  "remainingBudget": { "protein": 40 },   // (160-40)/160 = 0.75 > 0.30 — signal fires
  "dailyTargets": { "protein": 160 }
}
```

**Rule:** Before adding a field to the eval schema, check whether the service already derives it from inputs the eval already passes. If yes, calibrate those inputs to exercise the threshold; don't shadow the computation with a parallel field.

## Import shared Zod schemas — never re-declare intent enums in dataset-schemas.ts

When a dataset schema's `input` field uses an enum that already exists in the codebase (e.g. `PhotoIntent` from `@shared/constants/preparation`), import `photoIntentSchema` directly rather than recreating the union literal:

```typescript
// ❌ WRONG — duplicates source of truth, drifts when intents change
intent: z.enum(["log", "calories", "recipe", "identify", "label"]).default("log"),

// ✅ CORRECT — single source of truth, stays in sync automatically
import { photoIntentSchema } from "@shared/constants/preparation";
intent: photoIntentSchema.default("log"),
```

This also ensures the dataset schema accepts newly-added intents (e.g. `"menu"`) without a separate schema update.

## Related Files

- `evals/lib/dataset-schemas.ts`
- `evals/runner-*.ts`
- `server/lib/macro-gap-context.ts`

## See Also

- [Multi-suite eval framework via `SuiteConfig`](../design-patterns/multi-suite-eval-framework-suiteconfig-2026-05-13.md)
- [Eval assertion gotchas](../best-practices/eval-assertion-gotchas-2026-05-13.md)
