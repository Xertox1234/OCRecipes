---
title: "OpenAI Tool Schema/Handler Drift — Phantom Parameters"
track: bug
category: logic-errors
tags: [openai, tool-use, function-calling, schema-drift, ai-integration]
module: server
applies_to: ["server/services/**/*.ts"]
symptoms:
  - "Tool handler reads `args.X` but `X` is not declared in the OpenAI schema"
  - "Tool call silently defaults to `0` or `undefined` for the missing parameter"
  - "Schema declares a property the handler never reads"
created: 2026-04-12
severity: high
---

# OpenAI Tool Schema/Handler Drift — Phantom Parameters

## Problem

The `add_to_meal_plan` tool handler referenced `args.recipeId`, but the OpenAI function schema only defined `plannedDate`, `mealType`, and `notes`. OpenAI only populates parameters that exist in the schema, so `args.recipeId` was always `undefined`, defaulting downstream to `0`. Meanwhile, the `notes` parameter defined in the schema was never consumed by the handler.

## Symptoms

- AI tool call appears to succeed but writes a row with `recipeId = 0`
- Server logs show the tool firing with one set of args; the handler logs a different set
- Schema property exists for documentation only; the handler ignores it

## Root Cause

The handler was written with assumptions about what the AI "might" send rather than matching the schema exactly. As the schema evolved (or was written by a different author), the handler drifted. There is no compile-time link between the schema JSON and the handler's TypeScript — both can change independently.

## Solution

Make handler usage match the schema property set exactly. For each `args.X` in a handler, verify `X` appears in the schema's `properties`. For each schema property, verify it is consumed in the handler. If the handler needs data not in the schema (e.g., `recipeId`), either add it to the schema or fetch it from the database / context.

```typescript
// Schema declares plannedDate, mealType, notes
// Handler must read only those — fetch recipeId from context if needed
const handler = (args: {
  plannedDate: string;
  mealType: string;
  notes?: string;
}) => {
  const recipeId = ctx.currentRecipeId; // from server-side context, not args
  // ... use plannedDate, mealType, notes ...
};
```

## Prevention

- Tool handlers must use exactly the parameters defined in the schema — no phantom references, no unused schema params.
- When adding or modifying a tool: (1) define the schema first, (2) write the handler to use only those params, (3) if the handler needs more data, add it to the schema or pull it from server-side context.
- Quick audit: for each `args.X` in a tool handler, grep the schema for `X`. For each schema property, grep the handler for `args.X`.
- Consider generating handler param types from the schema with Zod — drift becomes a compile error.

## Related Files

- `server/services/nutrition-coach.ts` — `add_to_meal_plan` tool

## See Also

- [Validate LLM tool date parameters](../conventions/validate-llm-tool-date-parameters-calendar-check-2026-05-13.md)
- [Typed navigation dispatch AI actions](../design-patterns/typed-navigation-dispatch-ai-actions-2026-05-13.md)
