---
title: Test factories must use `in`-checks, not `??`, for nullable override fields — `?? default` converts an explicit null back to the default
track: knowledge
category: conventions
tags: [testing, vitest, test-factories, nullability, false-confidence]
module: shared
applies_to: ["**/__tests__/**/*.ts", "server/__tests__/factories/**/*.ts"]
created: 2026-07-12
---

# Test factories must use `in`-checks, not `??`, for nullable override fields — `?? default` converts an explicit null back to the default

## Rule

A test factory that accepts overrides for a **nullable** field must distinguish "caller omitted the key" from "caller passed `null`":

```typescript
// ❌ Bad — an explicit null silently becomes 150
dailyProteinGoal: overrides.dailyProteinGoal ?? 150,

// ✅ Good — explicit null survives; omission gets the default
dailyProteinGoal:
  "dailyProteinGoal" in overrides ? overrides.dailyProteinGoal : 150,
```

## Smell patterns

- A test named "…when the user has no X set" that passes `{ x: null }` into a factory whose default for `x` is non-null.
- A test asserting behavior for the null case that keeps passing after the null-handling code is deleted.

## Why

`??` treats `null` and `undefined` identically, so the factory re-injects the default and the production code never sees the null. The test then pins the wrong behavior while appearing to cover the null path. This masked a real defect: `coach-context-builder.ts`'s protein chip fabricated "I need 100g more protein" for users with no protein goal, and the test asserting the fallback passed only because the factory's `??` supplied the 150 — the production `?? 150` it appeared to test was never the value source under test.

## Exceptions

Non-nullable fields (where `null` is not a legal value) may keep `??` — there is no explicit-null case to preserve. Prefer `in`-checks anyway when the field's column is nullable in the schema.

## Related Files

- `server/services/__tests__/coach-context-builder.test.ts` — `makeUser` factory, `in`-check fix
- `server/services/coach-context-builder.ts` — the defect the masked test hid

## See Also

- [../logic-errors/truthy-sentinel-default-bypasses-fallback-2026-05-13.md](../logic-errors/truthy-sentinel-default-bypasses-fallback-2026-05-13.md) — the production-code sibling: truthy defaults swallowing sentinel values
