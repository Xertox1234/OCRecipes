---
title: 'Defense-in-depth: client-to-DB numeric validation pipeline'
track: knowledge
category: design-patterns
module: server
tags: [security, validation, defense-in-depth, check-constraint, numeric]
applies_to: [client/**/*.ts, server/routes/**/*.ts, shared/schema.ts]
created: '2026-05-13'
---

# Defense-in-depth: client-to-DB numeric validation pipeline

## When this applies

When parsed/AI-generated numeric values flow from client → server → database, validate at **every layer** to prevent 500 errors from CHECK constraint violations. Any pipeline where external data (OCR, AI, user input) flows into columns with CHECK constraints — if the DB has a constraint, the parser and route should enforce the same rule.

## Examples

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│ Client Parse │───▶│ Server Route │───▶│ DB CHECK     │
│ reject < 0   │    │ clamp(v, 0)  │    │ col >= 0     │
│ reject > max │    │              │    │              │
└─────────────┘    └──────────────┘    └──────────────┘
```

```typescript
// Layer 1: Client parser — reject invalid values early
function extractNumber(raw: string): number | null {
  const num = parseFloat(raw);
  if (isNaN(num) || num < 0 || num > MAX_VALUE) return null;
  return num;
}

// Layer 2: Server route — clamp before DB insertion
const clamp = (v: number | null) => Math.max(v ?? 0, 0);
const scaledCalories = clamp(labelData.calories) * servings;

// Layer 3: DB schema — last-line defense (produces 500 if hit)
caloriesNonNeg: check("bn_calories_gte0", sql`${table.calories} >= 0`),
```

## Why all three layers

- **Client:** Best UX — user sees `null` instead of wrong data
- **Server:** Prevents 500s from AI hallucinations (OpenAI can return negative values)
- **DB:** Catches bugs in application code; all nutrition tables should have these

## Origin

2026-04-07-full-2 findings M5, M7, M6, L8

## See Also

- [Input validation with Zod](../conventions/input-validation-with-zod-2026-05-13.md)
