---
title: "Call cancelAnimation before snapping chevron in QuickLogDrawer"
status: backlog
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, animation]
---

# Call cancelAnimation before snapping chevron in QuickLogDrawer

## Summary

The `useEffect` in `QuickLogDrawer` that snaps `chevronRotation.value` on `reducedMotion` change does not call `cancelAnimation` first. An in-progress `withTiming` animation may fight the snap assignment.

## Background

Deferred from 2026-05-02 full audit (finding L15). `client/components/home/QuickLogDrawer.tsx` lines 91-96. This mirrors the documented pattern in `docs/patterns/animation.md` ("cancelAnimation + reset when reducedMotion toggles at runtime"). The WeightLogDrawer and FastingDrawer both follow this pattern correctly.

## Acceptance Criteria

- [ ] The `reducedMotion` snap effect calls `cancelAnimation(chevronRotation)` before assigning the snap value
- [ ] Behavior matches the pattern in `docs/patterns/animation.md`

## Implementation Notes

```js
useEffect(() => {
  if (reducedMotion) {
    cancelAnimation(chevronRotation);
    chevronRotation.value = isOpen ? 90 : 0;
  }
}, [reducedMotion]);
```

Import `cancelAnimation` from `react-native-reanimated`.

## Dependencies

- None

## Risks

- None — one-liner fix

## Updates

### 2026-05-02

- Initial creation (deferred from audit L15)
