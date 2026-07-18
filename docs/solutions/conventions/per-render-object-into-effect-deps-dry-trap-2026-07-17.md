---
title: "DRY-ing a fresh-per-render object into a useEffect makes the effect fire every render — inline the duplication instead"
track: knowledge
category: conventions
module: client
tags: [react, hooks, useeffect, dependency-array, reanimated, code-review, dry]
applies_to: [client/**/*.ts, client/**/*.tsx]
symptoms: ["reviewer suggests reusing a locally-built config object inside an effect for DRY", "effect re-fires on every render after a DRY refactor", "withTiming/withSpring re-triggered per render with no state change"]
created: 2026-07-17
---

# DRY-ing a fresh-per-render object into a useEffect makes the effect fire every render — inline the duplication instead

## Rule

A config object built fresh each render (e.g. `{ ...someTokenConfig, duration: reducedMotion ? 0 : … }`) may be used freely in event handlers, but do NOT reference it from a `useEffect` to deduplicate construction. Inline the construction inside the effect (deriving from primitives already in the deps), or hoist it to module scope if it is fully static. When the duplication is deliberate, say so in a comment — otherwise the next reviewer proposes the "cleanup" again.

## Smell patterns

- Review feedback of the form "`X` is computed twice — reuse the local" where `X` is an object/array local and one use site is inside `useEffect`.
- An effect whose deps include an object built in the component body without memoization.

## Why

Referencing the outer object from the effect obligates it into the dependency array (`react-hooks/exhaustive-deps`). Its identity is new every render, so the effect re-fires per render — in the motivating case, re-triggering `withTiming` on a Reanimated shared value on every render instead of only on state changes. Omitting it from deps instead trips the lint rule and misleads readers. The three duplicated lines are load-bearing: they keep the effect's deps primitive (`[floated, reducedMotion, …]`).

This trap is reviewer-shaped: in PR #660, two independent reviewers suggested the DRY refactor as a cleanup; applying it would have introduced the per-render re-fire. Don't rely on React Compiler to stabilize the object either — effect re-fire frequency is correctness, not a memoization optimization to delegate.

## Examples

```tsx
// Handlers use the local freely — no deps involved:
const focusTiming = { ...focusTimingConfig, duration: reducedMotion ? 0 : focusTimingConfig.duration };
const handleFocus = () => { focusProgress.value = withTiming(1, focusTiming); };

useEffect(() => {
  // Deliberately duplicates focusTiming rather than referencing it: the local
  // is a fresh object every render, and depending on it would make this
  // effect re-fire per render.
  labelProgress.value = withTiming(floated ? 1 : 0, {
    ...focusTimingConfig,
    duration: reducedMotion ? 0 : focusTimingConfig.duration,
  });
}, [floated, reducedMotion, labelProgress]);
```

## Exceptions

- Fully static object → hoist to module scope (stable identity, safe to share).
- An object memoized on primitive inputs is shareable — but for a 3-line spread, the inline duplication is simpler than the memo.

## Related Files

- `client/components/TextInput.tsx` — `focusTiming` / `labelProgress` effect (the motivating case)

## See Also

- [Intentional useEffect dependencies — document the WHY](intentional-useeffect-dependencies-2026-05-13.md) — the same family from the other direction: annotating deliberate dep choices so they survive review
