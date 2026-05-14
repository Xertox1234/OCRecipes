---
title: "Define pure functions outside React component bodies"
track: knowledge
category: conventions
tags: [react, react-native, performance, pure-functions, hooks]
module: client
applies_to: ["client/**/*.tsx"]
created: 2026-05-13
---

# Define pure functions outside React component bodies

## Rule

When a function inside a React component does not depend on props, state, or hooks, define it **outside** the component body at module scope. This avoids recreating the function on every render and eliminates the need for `useCallback` or `useMemo`.

## Examples

```typescript
// Good: Pure function at module scope — created once, never recreated
function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

export default function CookSessionReviewScreen() {
  // Uses getConfidenceLabel() and formatDelta() — no useCallback needed
}
```

```typescript
// Bad: Pure function inside component — recreated on every render
export default function CookSessionReviewScreen() {
  function getConfidenceLabel(confidence: number): string {
    if (confidence >= 0.8) return "High";
    if (confidence >= 0.5) return "Medium";
    return "Low";
  }
  // ...
}
```

## Rule of thumb

If the function doesn't reference `props`, `state`, `ref`, `theme`, or any hook result, it belongs outside the component.

## Why

Module-scope functions are created once at module load. Functions defined inside a component are recreated on every render, allocating a new closure each time. The performance cost is small per function but compounds with renders and the GC pressure across many components.

## Key difference from `*-utils.ts` extraction

The "Pure Function Extraction for Vitest Testability" pattern extracts functions to _separate files_ (`*-utils.ts`) to make them testable in Vitest without React Native imports. This rule simply moves functions _above_ the component in the same file for performance — no new file needed.

## Related Files

- `client/screens/CookSessionReviewScreen.tsx` — `getConfidenceLabel()`
- `client/screens/SubstitutionResultScreen.tsx` — `formatDelta()`

## See Also

- [Extract pure functions to `*-utils.ts` for Vitest testability](../best-practices/extract-pure-functions-for-vitest-testability-2026-05-13.md)
