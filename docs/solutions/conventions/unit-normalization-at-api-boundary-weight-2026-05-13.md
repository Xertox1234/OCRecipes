---
title: "Unit normalization at API boundary (weight)"
track: knowledge
category: conventions
tags: [api, units, normalization, weight, drizzle]
module: server
applies_to: ["server/routes/**/*.ts", "server/services/**/*.ts"]
created: 2026-05-13
---

# Unit normalization at API boundary (weight)

## Rule

Normalize to a single canonical unit (kg) at the API boundary before storage. Never store the client's raw numeric value when units may vary.

## Why

The `weight_logs` table stores weights as decimal strings. If the client sends `lb` and the server stores it as-is, the table contains a mix of `lb` and `kg` values — making trend calculations and comparisons meaningless (75.5 lb looks like 75.5 kg, which is 166 lb).

## Examples

```typescript
// server/routes/weight.ts
const createWeightLogSchema = z.object({
  weight: z.number().positive().max(999),
  unit: z.enum(["lb", "kg"]), // required — never defaulted
  // ...
});

const weightKg =
  validated.unit === "lb" ? validated.weight * 0.453592 : validated.weight;

await storage.createWeightLog({
  weight: weightKg.toFixed(2), // always kg
  unit: "kg", // always "kg" in DB
  // ...
});
```

## Rules

- The `unit` column in `weight_logs` is always `"kg"` after this normalization (external sources like HealthKit already send kg)
- The request-schema `unit` field is **required — never `.default(...)`**. A defaulted unit silently mis-converts whenever the client's real unit differs from the default: a `.default("lb")` here once divided every kg-entered value by ~2.2 because the client sent no unit. Fail closed — reject a request with no `unit`.
- The `weight_logs.unit` DB _column_ still defaults to `"lb"`; that default only classifies rows created before this normalization — treat those rows as ambiguous-unit data
- Always store with `.toFixed(2)` to preserve two decimal places of precision

## Related Files

- `server/routes/weight.ts`
- `server/services/healthkit-sync.ts`
- `shared/schema.ts` → `weightLogs`

## Origin

Audit finding M25 (2026-04-18).

## See Also

- [kJ → kcal conversion in nutrition parsers](kj-to-kcal-conversion-nutrition-parsers-2026-05-13.md)
