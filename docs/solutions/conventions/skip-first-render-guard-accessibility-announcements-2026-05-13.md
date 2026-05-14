---
title: "Skip-first-render guard for accessibility announcements in conditionally-rendered components"
track: knowledge
category: conventions
tags:
  [
    react-native,
    accessibility,
    announceForAccessibility,
    useref,
    conditional-rendering,
  ]
module: client
applies_to: ["client/components/**/*.tsx"]
created: 2026-05-13
---

# Skip-first-render guard for accessibility announcements in conditionally-rendered components

## Rule

When a component is conditionally rendered (e.g. shown only while a stream is active) and needs to announce its own internal state changes via `AccessibilityInfo.announceForAccessibility`, it must skip the **initial mount announcement** to avoid double-firing with the parent's broader announcement.

## Examples

The problem: A parent announces "Coach is thinking..." at stream start. The child `CoachStatusRow` mounts at the same time with an initial `statusText` value. Without a guard, its `useEffect` fires immediately and a second announcement fires before the first has finished — producing garbled or duplicate VoiceOver output.

```typescript
// BAD — announces immediately on mount, double-fires with parent
export function CoachStatusRow({ statusText }: { statusText: string }) {
  useEffect(() => {
    if (statusText) {
      AccessibilityInfo.announceForAccessibility(statusText);
    }
  }, [statusText]);
  // ...
}
```

```typescript
// GOOD — skips first value; only announces changes that happen after mount
export function CoachStatusRow({ statusText }: { statusText: string }) {
  const prevStatusRef = useRef("");

  useEffect(() => {
    if (
      statusText &&
      prevStatusRef.current !== "" &&
      statusText !== prevStatusRef.current
    ) {
      AccessibilityInfo.announceForAccessibility(statusText);
    }
    prevStatusRef.current = statusText;
  }, [statusText]);
  // ...
}
```

## Why

Because the component unmounts between streaming sessions, `prevStatusRef.current` resets to `""` on each mount. The first value is therefore always skipped — the parent covers the initial announcement. Subsequent phase changes (e.g. `"Thinking..."` → `"Searching your data..."`) are announced when they arrive.

## Exceptions

Rule: apply this guard whenever a conditionally-rendered child needs to announce state changes but a parent already announces the transition that causes the child to appear.

## Related Files

- `client/components/coach/CoachStatusRow.tsx`
- `client/components/coach/CoachChat.tsx` (parent announces `"Coach is thinking..."` at stream start)

## See Also

- [Cross-platform live region announcements](../design-patterns/cross-platform-live-region-announcements-2026-05-13.md)
- [Ref guard for one-shot effects](../design-patterns/ref-guard-for-one-shot-effects-2026-05-13.md)
- [Dynamic accessibility announcements](../design-patterns/dynamic-accessibility-announcements-2026-05-13.md)
