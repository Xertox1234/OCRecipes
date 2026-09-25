---
title: 'A per-gesture "last shown" bridge gate must reset at gesture start; a "last applied" native-state gate must not'
track: knowledge
category: design-patterns
module: client
severity: low
tags: [react-native, reanimated, gesture, performance, camera, hooks]
symptoms: ['A UI-thread-to-JS bridge gate (per docs/legacy-patterns/animation.md "Gate runOnJS on Shared-Value Transitions") never re-fires for a second gesture that ends at the same value the first one left off at', 'A live readout that should show at the start of every gesture silently stays hidden if the gesture ends in the same displayed bucket as the previous one']
applies_to: [client/camera/hooks/useCameraFocusAndZoom.ts, client/hooks/useScrollLinkedHeader.ts]
created: 2026-09-25
---

# A per-gesture "last shown" bridge gate must reset at gesture start; a "last applied" native-state gate must not

## When this applies

`docs/legacy-patterns/animation.md` → "Gate `runOnJS` on Shared-Value Transitions, Not on Every Frame" already covers gating a single UI-thread→JS bridge call on a **discrete** transition (a boolean, a bucket). This rule extends it for the case where:

1. The underlying value is **continuous** (e.g. a pinch-zoom float), not naturally discrete, and must itself be discretized before the transition check applies, AND
2. More than one bridge call derives from the same gesture, each needing its **own** discretization and its **own** "last value" `SharedValue` — because the two calls serve different consumers with different lifetimes (one mirrors long-lived external/native state; the other mirrors a value that is only meaningful for the duration of the current gesture).

## Pattern

`client/camera/hooks/useCameraFocusAndZoom.ts`'s pinch-to-zoom gates two independent bridge calls off the same continuous `zoom` value, each discretized differently and reset differently:

```ts
const lastAppliedZoom = useSharedValue(1); // mirrors native camera state — NEVER reset
const lastZoomLabelText = useSharedValue<string | null>(null); // mirrors an on-screen label — reset per gesture

const pinchGesture = Gesture.Pinch()
  .onStart(() => {
    zoomAtGestureStart.value = zoom.value;
    // Reset ONLY the display gate. A new gesture must always show the live
    // readout at least once, even if it ends in the same displayed bucket the
    // previous gesture left off in.
    lastZoomLabelText.value = null;
  })
  .onUpdate((e) => {
    zoom.value = clampZoom(/* ... */);

    // Gate 1: numeric epsilon, tracks NATIVE state, never resets. The camera's
    // actual zoom does not reset when a gesture ends, so re-sending a value
    // it's already at on the next gesture would be a wasted bridge call.
    if (shouldApplyZoom(zoom.value, lastAppliedZoom.value)) {
      lastAppliedZoom.value = zoom.value;
      scheduleOnRN(setCameraZoom, zoom.value);
    }

    // Gate 2: display-string bucket, tracks a value scoped to THIS gesture.
    const nextZoomLabel = formatZoomLabel(zoom.value);
    if (nextZoomLabel !== lastZoomLabelText.value) {
      lastZoomLabelText.value = nextZoomLabel;
      scheduleOnRN(showZoomLabel, zoom.value);
    }
  });
```

## Rules

- **Discretize a continuous value before comparing it**, using a comparison that matches what the *consumer* actually cares about — a numeric epsilon (`Math.abs(next - last) > epsilon`) for an imperative native call where sub-threshold movement has no observable effect, or a formatted-string/bucket compare (`nextLabel !== lastLabel`) for a UI value where the user only perceives the *rendered* text changing, not the underlying float. These two discretizations can legitimately disagree on the same raw value (a delta can cross the epsilon while staying in the same display bucket, or vice versa) — that's expected, not a bug, because they gate different consumers.
- **Ask what the tracked "last value" outlives before deciding whether to reset it.** A gate mirroring state that persists independently of the current interaction (native hardware state, a server-synced value) must NOT reset when the interaction ends — the state it mirrors didn't reset either, so resetting the gate would just re-send a value the consumer is already at. A gate mirroring something whose meaning is scoped to the current interaction (a live "you are here" readout, a transient in-gesture affordance) MUST reset at the start of the next interaction, or a second gesture that happens to end in the same bucket as the first silently never fires the bridge call at all — the gate can't tell "genuinely unchanged since last shown" apart from "never shown this gesture" without an explicit reset.
- Reset the display-scoped gate in the gesture's `.onStart`, not its `.onEnd` — resetting on start means the very first `.onUpdate` frame of the new gesture is guaranteed to look like a transition (compared against the reset sentinel), regardless of how many frames the previous gesture accumulated or when cleanup ran.

## Why

Without the per-gesture reset, the bug is invisible in the common case (most gestures change the displayed value at least once) and only shows up when a user makes two gestures that happen to land on the same rounded/bucketed value — exactly the kind of intermittent, hard-to-reproduce gap that a single-gate design won't catch in casual testing. It was caught here by explicitly tracing a "second gesture, same displayed value" test case against the fix, not by manual testing.

## Exceptions

- If the bridged value has only ONE consumer and that consumer's state genuinely never resets (e.g. `useScrollLinkedHeader.ts`'s `lastBarVisible`, which mirrors a boolean UI state that persists across scroll gestures by design), a single non-resetting gate is correct — this rule only applies once a gesture-scoped "last shown" concept exists alongside a persistent one.
- Don't manufacture two gates when one value change would naturally satisfy both consumers at the same threshold — introduce the split only when the two consumers' correctness actually depends on different thresholds or different reset semantics, as here (native `setZoom` tolerates sub-visible drift; the on-screen label must not silently stay hidden across a gesture boundary).

## Related Files

- `client/camera/hooks/useCameraFocusAndZoom.ts`
- `client/camera/hooks/useCameraFocusAndZoom-utils.ts`
- `client/hooks/useScrollLinkedHeader.ts`

## See Also

- [VisionCamera `<Camera zoom={SharedValue}>` prop requires the worklets package](../runtime-errors/vision-camera-zoom-prop-requires-worklets-package-2026-07-14.md) — why this hook drives zoom imperatively (`controller.setZoom`) instead of a fully UI-thread-bound SharedValue prop, which is the reason a JS-thread bridge gate is needed here at all
