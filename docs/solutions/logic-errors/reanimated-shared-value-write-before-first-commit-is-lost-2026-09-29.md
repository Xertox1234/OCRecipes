---
title: "A Reanimated shared-value write issued before its Animated.View's first commit does not reach the native view"
track: bug
category: logic-errors
tags: [react-native, reanimated, animation]
module: client
applies_to: [client/components/**/*.tsx, client/hooks/**/*.ts]
symptoms: [An already-expanded/already-active Animated.View renders at the wrong (usually zero) size on the very first paint even though the driving shared value was set synchronously inside the first onLayout call, A user-triggered toggle of the same state animates correctly every time — only the value present at MOUNT is affected, The bug's exact manifestation is non-deterministic across app launches (which of several sibling instances are affected varies), collapsing to "it self-corrects after one interaction" and easy to write off as a simulator timing fluke, Diagnostic logging shows the shared-value write happening with the correct value at the correct time, yet the rendered native height/opacity/transform does not reflect it]
created: '2026-09-29'
severity: medium
---

# A Reanimated shared-value write issued before its Animated.View's first commit does not reach the native view

## Problem

A "measure-then-animate" component (the idiom Reanimated's own official `AccordionItem`
example uses: a shared value starts at 0, `onLayout` measures the real content size and
writes it into the shared value, `useAnimatedStyle` renders from that value) can render
**stuck at its initial value** on the very first paint when the component starts in the
"already active" state (e.g. already expanded, already visible) — even though `onLayout`
fires promptly and the shared-value write happens with the correct measured value.

## Symptoms

- An `Animated.View` that should already be expanded/visible on mount instead renders at
  its initial (usually zero) size, with no visible content, despite `onLayout` reporting a
  correct non-zero measurement synchronously.
- The surrounding non-animated UI (a chevron icon, a toggle's `accessibilityState`) can be
  perfectly correct — because it was initialized directly from the same prop the animated
  value should also reflect — making the bug look isolated to "just the height," not a
  general init problem.
- Toggling the same state via user interaction (which updates the driving prop AFTER mount,
  well after the first commit) works every time. Only the value baked in at the FIRST
  render is affected.
- Reproduces non-deterministically across app cold-launches — which of several sibling
  instances (e.g. multiple sections built from the same component) are affected varies
  launch to launch, because it depends on exactly when each instance's first `onLayout`
  lands relative to its own first commit.

## Root Cause

Reanimated's shared values are written to directly from JS (`sharedValue.value = x`), and
the UI-thread binding that actually applies that value to the native view is established
when the driven `Animated.View` first commits (mounts). A JS-side write that lands
**before** that commit — e.g. from an `onLayout` callback that happens to fire very early,
before React has finished committing the tree for the first time — does not reliably reach
the native side. The write is not queued or replayed once the binding is established; it is
simply lost. A write issued **after** that commit (a later `onLayout`, or an effect that
runs post-commit) works normally, because the binding already exists.

This is easy to miss because nothing about the write itself is wrong: the callback ran, the
measured value was correct, and the assignment happened. The defect is purely about
**timing relative to the commit**, and standard reasoning about React state/effects doesn't
cover it — this is a Reanimated UI-thread attachment detail, not a React ordering guarantee
(contrast
[child-before-parent effect ordering is a SINGLE-COMMIT guarantee](child-before-parent-effect-order-is-a-single-commit-guarantee-2026-08-05.md),
which is about React's own effect-ordering rules, not Reanimated's native binding).

An initial fix attempt that instead tried to suppress/omit the animated style object from
the component's `style` array while unmeasured (so the native height would be governed by
plain layout instead) passed unit tests (where `useAnimatedStyle` is mocked as a plain
function call) but **did not fix the bug on a real device** — conditionally
including/excluding a Reanimated-produced style object across renders is its own separate
fragility (Reanimated does not reliably re-attach once a style is removed and then
reintroduced) and should not be reached for as a workaround for this issue.

## Solution

Re-forward the same first measurement once more, from a `useEffect` (or
`requestAnimationFrame`) — which by definition runs **after** the commit that mounted the
component. Track whether the first real measurement has already been forwarded with a
plain boolean (state or ref); do not store the raw layout event object for the re-forward —
React Native's `LayoutChangeEvent` is pooled, and its `nativeEvent` is already
released/nulled by the time an effect runs, so stash the plain height/value you need instead:

```tsx
const [hasMeasuredOnce, setHasMeasuredOnce] = useState(false);
const pendingReforwardHeightRef = useRef<number | null>(null);

const handleContentLayout = useCallback(
  (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    onContentLayout(e); // the normal, synchronous path
    if (!hasMeasuredOnce && height > 0) {
      pendingReforwardHeightRef.current = height;
      setHasMeasuredOnce(true);
    }
  },
  [onContentLayout, hasMeasuredOnce],
);

useEffect(() => {
  if (hasMeasuredOnce && pendingReforwardHeightRef.current !== null) {
    onContentLayout({
      nativeEvent: { layout: { height: pendingReforwardHeightRef.current } },
    } as LayoutChangeEvent);
    pendingReforwardHeightRef.current = null;
  }
}, [hasMeasuredOnce, onContentLayout]);
```

This keeps the underlying shared-value-driven hook/mechanism completely unchanged — no new
animation mechanism, no conditional style-array membership — it just guarantees the driving
value gets written at least once **after** the first commit, which is the one pattern that
measurably works.

## Prevention

- When a Reanimated-driven view can start in its "already active" state on mount (not just
  reach that state later via a user action), do not assume a synchronous first-`onLayout`
  write is sufficient — verify on a real device/simulator with several cold launches, not
  just a unit test with mocked animation primitives.
- Jsdom/unit-test mocks for `useSharedValue`/`useAnimatedStyle` are plain JS function calls
  with no concept of a native "first commit" attachment step, so they cannot catch this
  class of bug. A unit test can (and should) cover the component's OWN re-forwarding logic
  (e.g. assert the measurement callback is invoked twice for an initial active state), but
  the fix itself must be verified with real device/simulator evidence.
- Never conditionally include/exclude a `useAnimatedStyle` result from a `style` array
  across renders as a workaround for an initial-value problem — it trades one native timing
  fragility for another (see Problem above).

## Related Files

- `client/components/home/CollapsibleSection.tsx` — the re-forward fix
- `client/hooks/useCollapsibleHeight.ts` — the shared measure-then-animate hook (left
  untouched; shared by `MicronutrientSection.tsx` and `HomeInlineDrawer.tsx`, with a test
  that pins its zero-height-before-measurement contract)
- `client/components/home/__tests__/CollapsibleSection.test.tsx` — asserts the re-forward
  call pattern directly, with `useCollapsibleHeight` stubbed

## See Also

- [Child-before-parent effect ordering is a SINGLE-COMMIT guarantee](child-before-parent-effect-order-is-a-single-commit-guarantee-2026-08-05.md) — the React-side analog: reasoning about "which fires first" must name the commit, but that solution is about React's effect-ordering guarantee, not Reanimated's native attachment timing
- [Measure-then-animate collapsible height with -1 sentinel for auto](../design-patterns/measure-then-animate-collapsible-height-2026-05-13.md) — the general pattern this bug affects; note its `MealSlotSection` code example no longer exists in the current codebase (the screen was since rewritten without a height-measurement mechanism) — treat that example as illustrative only, not a live reference
