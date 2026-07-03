---
title: Module-level mutable counters persist stale state across Fast Refresh
track: bug
category: code-quality
module: client
severity: low
tags: [react-native, fast-refresh, module-state, dev-experience]
symptoms: ['UI cycle (tips, animations, prompts) starts at the wrong index after a hot reload', 'Counter survives between mount/unmount, breaking expected reset semantics', Behavior diverges between dev (Fast Refresh) and production]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-03-21'
---

# Module-level mutable counters persist stale state across Fast Refresh

## Problem

The Quick Log "Tip Card" component used a module-level `let tipCounter = 0` to cycle through tip messages. The counter survived Fast Refresh in dev, so reloading the component left the counter advanced and the "first tip" the user saw was unpredictable. The mutable state also lived outside React, hiding side effects from `useState` / `useReducer` machinery.

## Symptoms

- Tips appear in inconsistent order during development
- Counter behavior diverges between dev hot-reload and a fresh production launch
- ESLint and TypeScript see no problem — the variable is technically valid

## Root Cause

Module-level `let` bindings persist for the lifetime of the JavaScript bundle. Fast Refresh swaps the component but keeps the module instance, so the counter never resets. Module-scoped mutable state is also invisible to React DevTools and cannot be cleared via `<StrictMode>` double-invoke.

```tsx
// Bad — survives Fast Refresh, escapes React's lifecycle
let tipCounter = 0;
function TipCard() {
  const tip = TIPS[tipCounter++ % TIPS.length];
  return <Text>{tip}</Text>;
}
```

## Solution

For non-critical UI cycling, derive the initial value once inside `useState`:

```tsx
// Good — initialized per mount, scoped to the component
function TipCard() {
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  return <Text>{tip}</Text>;
}
```

## Prevention

- Module-level mutable bindings are a smell in React code. If state needs to persist across mounts, push it into a context, a ref, or an external store (Zustand, Jotai).
- For "pick one of N" UI, prefer `Math.random()` inside `useState` initializer over a counter.

## Related Files

- `client/components/quick-log/TipCard.tsx`

## See Also

- [Pure functions outside React component bodies](../conventions/pure-functions-outside-react-component-bodies-2026-05-13.md)
