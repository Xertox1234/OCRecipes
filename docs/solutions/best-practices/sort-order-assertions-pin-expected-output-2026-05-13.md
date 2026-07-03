---
title: 'Sort-order assertions: pin expected output, don''t self-sort'
track: knowledge
category: best-practices
module: shared
tags: [testing, vitest, assertions, sort-order, contracts]
applies_to: ['**/__tests__/**/*.test.ts']
created: '2026-05-13'
---

# Sort-order assertions: pin expected output, don't self-sort

## When this applies

When testing a function whose contract includes sort order, **assert against a pinned expected array**, not against a self-sorted or structurally-checked result. Two specific traps to avoid.

## Examples

```typescript
// ❌ WRONG — self-sorting masks sort regressions
expect(result.sort()).toEqual(["a", "b", "c"]);
// If the function returns ["c", "a", "b"], .sort() mutates it back to
// ["a", "b", "c"] and the test passes. The function's sort behavior is
// never actually tested.

// ❌ WRONG — meta-assertion passes trivially for length-1 results
const sorted = [...result].sort();
expect(result).toEqual(sorted);
// If the function returns ["typescript"] (single element), it's trivially
// "sorted" by definition. The test gives confidence the function returned
// something, not that it returned the right thing in the right order.

// ✅ CORRECT — pinned expected output
expect(result).toEqual(["a", "b", "c"]);
// Locks in both element presence AND order. A regression in either is
// caught.
```

## Why

Sort-order contracts are easy to break (a refactor that swaps a `Set` for an `Array` loses determinism; a removed `.sort()` call goes unnoticed). The only test that catches it reliably is one that names the exact expected sequence. If the inputs make the expected list verbose, that's the cost of the contract — write it out.

## See Also

- [Explicitly test falsy boundary values](explicitly-test-falsy-boundary-values-2026-05-13.md)
