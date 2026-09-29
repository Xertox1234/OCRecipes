---
title: Measure-then-animate collapsible height — always an explicit height, never "auto"
track: knowledge
category: design-patterns
module: client
tags: [react-native, animation, reanimated, collapse, layout]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx, client/hooks/**/*.ts]
created: '2026-05-13'
last_updated: '2026-09-29'
---

# Measure-then-animate collapsible height — always an explicit height, never "auto"

## When this applies

A collapsible section whose content height is dynamic: measure it with `onLayout`, then animate
between 0 and the measured height. Use the shared hook `client/hooks/useCollapsibleHeight.ts`
instead of hand-rolling this.

## Rule

- The animated style always sets an explicit numeric `height`. Never switch to `"auto"`, and never
  drop the `height` key from the animated style: Reanimated doesn't reliably recalculate native
  layout when an animated property is removed. (This doc's 2026-05-13 version recommended a `-1`
  → `"auto"` sentinel. The live hook replaced that approach, and the code example it cited no
  longer exists.)
- Measure the content wrapper with `onLayout`. Ignore zero-height measurements, and keep the
  latest measurement in a shared value so a later toggle animates to the current size.
- On the first non-zero measurement, snap (no animation) to `isExpanded ? measured : 0`. After
  that, an expanded section follows content growth directly.
- Toggle in a `useEffect` keyed on `isExpanded`/`reducedMotion`: `withTiming` to the measured
  height or to 0, or set it instantly under reduced motion.

## Examples

```ts
// client/hooks/useCollapsibleHeight.ts (abridged)
const contentHeight = useSharedValue(0);
const animatedHeight = useSharedValue(0);
const hasMeasured = useRef(false);

const onContentLayout = useCallback((e) => {
  const raw = e.nativeEvent.layout.height;
  if (raw === 0) return; // ignore zero-height measurements
  const measured = clampDrawerHeight(raw, maxHeight);
  contentHeight.value = measured;
  if (!hasMeasured.current) {
    hasMeasured.current = true;
    animatedHeight.value = isExpanded ? measured : 0; // first measurement: snap
  } else if (isExpanded) {
    animatedHeight.value = measured; // content grew or shrank while open
  }
}, [isExpanded, maxHeight]);

const animatedStyle = useAnimatedStyle(() => ({ height: animatedHeight.value }));
```

Consumers: `client/components/home/CollapsibleSection.tsx`,
`client/components/home/HomeInlineDrawer.tsx`, `client/components/MicronutrientSection.tsx`.

## Why

A fixed height clips content when items are added or removed, so the height is re-measured. It
stays an explicit number because removing the animated `height` property is exactly what
Reanimated fails to re-lay out.

## Exceptions

A section that starts already expanded can still paint at height 0 on first load. The first
measurement's write can land before the `Animated.View`'s first commit, and Reanimated drops it.
`CollapsibleSection.tsx` re-sends that first measurement from a `useEffect`. See
[reanimated-shared-value-write-before-first-commit-is-lost-2026-09-29.md](../logic-errors/reanimated-shared-value-write-before-first-commit-is-lost-2026-09-29.md).

## Related Files

- `client/hooks/useCollapsibleHeight.ts` — the shared implementation

## See Also

- [Multi-section accordion with Set state](multi-section-accordion-with-set-state-2026-05-13.md)
- [Reduced motion animation pattern](reduced-motion-animation-pattern-2026-05-13.md)
