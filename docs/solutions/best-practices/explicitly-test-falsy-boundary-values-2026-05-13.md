---
title: Explicitly test falsy boundary values (`0` is not covered by `-1`/`1`)
track: knowledge
category: best-practices
module: shared
tags: [testing, validation, boundary-conditions, falsy-values, routes]
applies_to: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx']
created: '2026-05-13'
---

# Explicitly test falsy boundary values (`0` is not covered by `-1`/`1`)

## Rule

When a valid input range includes `0` (or any other falsy value), write an explicit test asserting that `0` is accepted — not just that `1` is accepted and `-1` is rejected.

## Examples

```typescript
// Testing a 0–23 hour range: these alone are NOT sufficient
it("accepts valid hour", ...) // tests "19" → 19
it("rejects negative", ...) // tests "-1" → undefined
it("rejects out-of-range", ...) // tests "24" → undefined

// ALSO required:
it("accepts 0 (lower boundary)", async () => {
  const res = await request(app).get("/api/carousel").set("X-User-Hour", "0");
  expect(buildCarousel).toHaveBeenCalledWith("1", null, 0); // NOT undefined
});
```

## Why it matters

Validation code written with `||` instead of `??` (or `> 0` instead of `>= 0`) silently rejects `0`. Without an explicit test for `0`, this class of bug has no coverage. The test suite passes, the type checker is happy, and midnight users silently get the wrong behavior.

## When to use

Any numeric parameter that accepts a 0-inclusive range: hours (0–23), page numbers (0-indexed), counts, array indices, percentages starting at 0.

**Origin:** PR #104 `X-User-Hour` header validation — 6 rejection tests were written but `"0"` was missing; caught in code review.

## See Also

- [Sort-order assertions: pin expected output](sort-order-assertions-pin-expected-output-2026-05-13.md)
