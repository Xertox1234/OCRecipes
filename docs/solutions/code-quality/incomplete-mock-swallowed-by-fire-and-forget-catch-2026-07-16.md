---
title: An incomplete mock of a fire-and-forget dependency passes silently because the production code's own .catch() swallows the mock's TypeError
track: bug
category: code-quality
tags: [testing, vitest, mocks, fire-and-forget, drizzle]
module: server
applies_to: [server/services/__tests__/**/*.test.ts]
symptoms: [A new test file mocks a chained builder (e.g. Drizzle's db.insert(...).values(...)) with only SOME of the methods the code under test actually calls on it, The test still passes giving no signal that the mocked write path is broken, The production code being tested wraps the real call in a .catch((err) => log.error(...)) fire-and-forget background write so the mock's thrown TypeError (missing method) is caught and logged never surfacing as a test failure]
created: '2026-07-16'
last_updated: '2026-07-16'
severity: low
---

# An incomplete mock of a fire-and-forget dependency passes silently because the production code's own .catch() swallows the mock's TypeError

## Problem

A new test file (`server/services/__tests__/barcode-lookup.test.ts`) mocked the `db` module's `insert(...).values(...)` chain with only `onConflictDoUpdate`. The code under test (`lookupBarcode`) actually calls `storage.insertBarcodeNutritionIfAbsent`, which chains `.onConflictDoNothing()` — a different method, absent from the mock. Every test in the file still passed: the missing method causes a real `TypeError` at runtime, but that call is a fire-and-forget background write (`storage.insertBarcodeNutritionIfAbsent(...).catch((err) => log.error(...))` in `barcode-lookup.ts`), so the thrown error is caught, logged, and never propagates to the test. The identical gap was found unpropagated to a SECOND file: `server/services/__tests__/nutrition-lookup.test.ts`'s shared `vi.mock("../../db", ...)` also only exposed `onConflictDoUpdate` (missing `onConflictDoNothing`), and was fixed the same way during this todo — by using a `vi.hoisted(() => ({ mockInsertValues: vi.fn().mockReturnValue({ onConflictDoUpdate: ..., onConflictDoNothing: ... }) }))` pattern so tests could also assert on the mock's call args (proving a fire-and-forget write's payload, not just that it doesn't throw).

## Root Cause

The mock was modeled on a sibling test file's mock (`nutrition-lookup.test.ts`), which only needed `onConflictDoUpdate` for its own code paths. Copying that mock into a new file exercising a different call site (`onConflictDoNothing`) left a silent gap: the new file's assertions all happened to be about return values (`per100g`, `isServingDataTrusted`, etc.), none of which depend on the insert succeeding — so nothing in the test observed the swallowed failure.

## Solution

When mocking a chained builder, include every terminal method any code path under test actually calls — not just the ones a copied/adjacent mock happened to need:

```typescript
insert: vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined), // ← the method THIS file's code path actually calls
  }),
}),
```

## Prevention

- Before copying a mock from a sibling test file, grep the code under test for every method actually invoked on the mocked chain — do not assume the sibling's mock is complete just because it's the same base module (`db`, `storage`, etc.).
- Be specifically suspicious of test coverage around **fire-and-forget** calls (`somePromise.catch((err) => log.error(...))`, no `await`) — a broken mock on that path fails invisibly. If a test is meant to validate that a fire-and-forget write actually happens, assert on the mock function itself (`expect(mockOnConflictDoNothing).toHaveBeenCalledWith(...)`), not just on unrelated return values.
- This gap recurring in a SIBLING test file (same `db` mock pattern, copied independently) confirms the existing Prevention bullet about not assuming a sibling's mock is complete — cite this as a second real occurrence, not hypothetical.

## Related Files

- `server/services/__tests__/barcode-lookup.test.ts` — the fixed mock
- `server/services/barcode-lookup.ts` — the fire-and-forget call site (`storage.insertBarcodeNutritionIfAbsent(...).catch(...)`)
- `server/storage/api-keys.ts` — where `.onConflictDoNothing()` is actually called (via `storage.insertBarcodeNutritionIfAbsent`)
- `server/services/__tests__/nutrition-lookup.test.ts` — the second fixed file (same incomplete mock pattern, fixed with `vi.hoisted`)

## See Also

- [A data-trust/label flag derived from secondary-source agreement instead of the provenance signal it's meant to represent](../logic-errors/trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md)