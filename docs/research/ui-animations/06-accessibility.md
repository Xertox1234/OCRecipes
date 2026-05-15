# 06 — Accessibility for motion

Animation excludes users when it's the only carrier of meaning, when it
makes some users physically unwell, or when it interferes with assistive
technologies. The fix isn't to remove animation — it's to design every
animation with a non-motion path that works for everyone.

This file is the why and the how. The implementation hook is already in
the project (`useAccessibility()`); the discipline is what's left.

## Why Reduce Motion exists

### The vestibular reality

Roughly 35% of adults over 40 experience vestibular dysfunction at some
point in life (the inner-ear system that handles balance and spatial
orientation). For some, large screen motion — zooming transitions,
parallax, full-screen swooshes — triggers nausea, dizziness, or migraine.

Other affected groups:

- People with post-concussion syndrome (often months-to-years recovery).
- People with chronic migraine.
- People with photosensitive epilepsy (rapid flashing is the main risk
  here, not "motion" specifically — but a Reduce Motion preference often
  also indicates flash sensitivity).
- People with anxiety disorders that make rapid screen change distressing.
- Older users, generally.

Apple introduced the iOS Reduce Motion setting in iOS 7 (2013) specifically
because users were reporting nausea from the new parallax and zoom
transitions. Android followed with similar settings.

### The numbers

Estimates vary, but multiple surveys put the share of users with Reduce
Motion enabled at 3–7% of the iOS user base. For an app with 100k users,
that's 3,000 to 7,000 people who will quit using your app if your scan
transition makes them ill. The fix is cheap.

### It's not just nausea

For users with attention disorders, screen motion that doesn't carry
meaning is constantly drawing focus away from the actual content. Reduce
Motion is also a _focus_ tool for these users, not only an _anti-nausea_
one. Designing for Reduce Motion therefore makes the app calmer for
everyone, not just people who _need_ it.

## How OCRecipes already handles it

The infrastructure is in place. Use it.

### `useAccessibility()` hook

```ts
import { useAccessibility } from "@/hooks/useAccessibility";

function MyComponent() {
  const { reducedMotion } = useAccessibility();
  // ...
}
```

Returns `{ reducedMotion: boolean }`. Reads from
`useReducedMotion()` (Reanimated 4) which subscribes to the OS preference
and updates live. The component re-renders when the user toggles the
setting at runtime.

### `useHaptics()` hook

```ts
import { useHaptics } from "@/hooks/useHaptics";
const haptics = useHaptics();
haptics.impact(); // light/medium/heavy
haptics.notification(Haptics.NotificationFeedbackType.Success);
haptics.selection();
```

Important: this hook _also_ disables haptics when reducedMotion is on. This
is debatable — Apple's official guidance is that haptics are not "motion"
and should continue to fire under Reduce Motion (because tactile feedback
doesn't trigger vestibular symptoms). The project has made a different
choice (haptics off under reducedMotion).

If you want to override for a specific case (`useSuccessFlash` deliberately
calls `Haptics.notificationAsync` directly to keep haptics on under reduced
motion), call `expo-haptics` directly. The pattern is already in the code.
See `useSuccessAnimation.ts` line 40.

**Recommendation.** For _delight_ haptics, accept the project's default
(off under reducedMotion). For _feedback_ haptics (success confirmation,
error warning, transaction complete), bypass the wrapper and call
`Haptics.notificationAsync` directly — the user needs to know the action
succeeded regardless of their motion preference.

## The three paths every animation needs

For every animation, you must define three paths.

### 1. Motion path (default)

The full animation: spring, timing, stagger, etc.

### 2. Reduced-motion path

A non-animating version that still gets to the same end state. Options,
in rough preference order:

- **Crossfade.** Old element fades to 0; new element fades from 0. The
  apple-default Reduce Motion substitute. Use this for entrance/exit.
- **Instant state change.** No transition at all. The end state appears.
  Use this for property changes (color, opacity flag).
- **Static success indicator.** Replace a self-drawing checkmark with a
  static checkmark. Replace a number ticker with the number.
- **Position the user can find.** If the change is "this list just got a
  new item," in reducedMotion just put it at the top with a brief color
  flash (color, not motion).

### 3. Haptic path (optional, for feedback animations)

If the animation's job is feedback (success, error, attention), fire the
haptic on both motion and reduced-motion paths. Tactile = not motion =
allowed.

### Sample shape

```ts
const { reducedMotion } = useAccessibility();
const opacity = useSharedValue(0);

const trigger = useCallback(() => {
  // Haptic always fires
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

  if (reducedMotion) {
    // Reduced-motion path: skip animation, ensure state is correct
    return;
  }

  // Motion path
  opacity.value = withSequence(
    withTiming(0.15, { duration: 100 }),
    withTiming(0, successFlashConfig),
  );
}, [reducedMotion, opacity]);
```

This is the shape `useSuccessFlash` uses. Copy it for any feedback
animation.

## The state-settling problem

The most common bug in reducedMotion fallbacks: the state ends up wrong
because the animation was _both_ visual change and state change.

### The bug

```ts
// BAD
const trigger = () => {
  if (reducedMotion) return;
  opacity.value = withSequence(withTiming(1), withTiming(0));
};
```

If a user has reducedMotion on, this function does nothing. But what if
some other code relies on `opacity.value` having been at 1 briefly?
Probably nothing, but if the flash was tied to a state machine ("flash
once, then mark as seen"), the state never advances.

### The fix

Either:

- The animation is _purely_ visual (decorative). Skipping is fine.
- The animation has a state side-effect. Do the side-effect _outside_ the
  animation:

```ts
const trigger = () => {
  markAsSeen();  // state change, runs regardless
  if (reducedMotion) return;
  opacity.value = withSequence(...);
};
```

Rule: animations should be _consequences of state_, not the cause of it.
If your animation runs a state transition, the state transition should
also run when the animation doesn't.

## The interrupted-animation problem

When reducedMotion _flips at runtime_ (user toggles it in Settings while
the app is open), in-flight animations are in an undefined state. The
shared value can be stuck mid-interpolation forever.

`useSuccessAnimation` handles this:

```ts
useEffect(() => {
  if (reducedMotion) {
    cancelAnimation(scale);
    scale.value = 1;
  }
  return () => {
    cancelAnimation(scale);
    scale.value = 1;
  };
}, [reducedMotion, scale]);
```

When reducedMotion flips to true, cancel any animation in flight and
snap the shared value to its rest position. On unmount, also cancel — so
a mid-flight animation doesn't try to update an unmounted component's
state.

Apply this pattern to any shared value you animate. Cost: ~5 lines of
code per shared value. Benefit: no janky edge cases when the user changes
their motion preference mid-flow.

## Screen reader (VoiceOver / TalkBack) and motion

Motion is irrelevant to screen reader users — they don't see it. But your
_announcements_ are.

### Announce state changes

If an action triggers an animation that signals success, also announce
success to the screen reader:

```ts
import { AccessibilityInfo } from "react-native";

AccessibilityInfo.announceForAccessibility("Meal logged");
```

The animation tells sighted users; the announcement tells screen reader
users. Both are necessary.

### Don't lock focus mid-animation

If you animate a modal in over 300 ms and immediately move VoiceOver focus
to a button inside it, the focus may land on the button before it's
on-screen. The user hears a label they can't see.

Either:

- Delay the announcement to after the animation completes.
- Don't auto-move focus on entrance; let the user discover the modal in
  their own time.

### Disable swipe gestures that conflict with screen reader gestures

VoiceOver intercepts swipe gestures (1-finger swipe = navigate; 2-finger
swipe = scroll; 3-finger swipe = page). A custom swipe-to-dismiss should
still work, but it won't if it competes with the VoiceOver gesture.

`SwipeableRow.tsx` in the project handles this by falling back to inline
buttons under `reducedMotion`. That's the right pattern — but consider
also falling back when `AccessibilityInfo.isScreenReaderEnabled()` is
true.

## Touch targets and gesture motion

If you require a gesture for an interaction (long-press, swipe), provide
a non-gesture path too.

- Long-press → also expose the menu via a button or tap.
- Swipe-to-dismiss → also expose a close button.
- Swipe-to-reveal-actions → also expose the actions via long-press or
  via a "more" tap.

For users with limited dexterity, gestures can be physically impossible.
The gesture is a _fast path_ for power users, not a _required path_.

## Flashing content

If your animation involves rapid flashing (multiple opacity transitions
per second, especially with high contrast), it can trigger seizures in
users with photosensitive epilepsy.

WCAG 2.3.1: content should not flash more than 3 times per second.

Practical implication: don't loop a high-contrast pulse at high frequency.
A 1-second slow pulse is fine. A 200 ms flash three times in succession is
fine. Eight flashes in two seconds is not.

This is rare to hit accidentally. Worth mentioning so you know the bound.

## Auto-playing content

Carousels, video, GIFs that play automatically.

- Auto-playing video must have an off control.
- Auto-advancing carousels should pause on focus and have visible pause.
- GIFs in chat: the app shouldn't auto-loop more than a few times.

OCRecipes doesn't currently have a lot of auto-play surface. If you add
one (e.g., a hero video on onboarding), make sure the off control is
discoverable.

## Color and motion together

If you're using motion to signal state and the user can't perceive motion
(reducedMotion on), state must be signaled by _color and content_. If
you're using color to signal state and the user can't perceive color
(color blindness), state must be signaled by _motion or content_. The
"or content" is what saves you in both cases — always have a text label.

Example: a successful save shows a green flash + checkmark + the word
"Saved." The motion alone is for sighted, motion-enabled users. The
flash alone is excluded by reducedMotion. The green alone is excluded by
some color vision. The checkmark + word "Saved" is the bedrock.

## A checklist before merging an animation

1. Does it have a `reducedMotion` path? Re-read the trigger code.
2. Does the state end up correct on the reducedMotion path?
3. Does the state end up correct if reducedMotion flips mid-animation?
4. Is there a cleanup on unmount that cancels the animation?
5. If the animation conveys meaning, is there also a screen reader
   announcement or a visible label?
6. If it's a gesture, is there a non-gesture path to the same outcome?
7. If it loops, does it pause when the screen unmounts or backgrounds?
8. If it flashes, is the frequency under 3 Hz?
9. Have you tested with VoiceOver on (iOS) or TalkBack on (Android)?
10. Have you tested with reducedMotion toggled both ways?

If all ten pass, you're done.
