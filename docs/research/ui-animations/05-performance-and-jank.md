# 05 — Performance & jank

A great-looking animation that drops frames is worse than a static UI.
Jank reads as "broken." This file is about understanding _why_ React Native
animations can drop frames, _what_ the architecture forces you to do, and
_how_ to profile when you suspect a problem.

## The 16.67 millisecond budget

A 60 Hz display refreshes every 1000 / 60 = 16.67 ms. To hit 60 fps, every
frame's work — JavaScript execution, layout, paint, GPU upload — must
complete in under 16.67 ms.

On 120 Hz displays (iPad Pro, recent iPhones, premium Android), the budget
is 8.33 ms. Modern React Native + Reanimated do honor 120 Hz on capable
devices, but most apps target 60 fps as the design baseline and let 120 Hz
be a bonus on hardware that can do it.

If frame work exceeds the budget, the GPU swaps in the _previous_ frame
again. Visible result: motion stutters, sometimes by a few pixels worth of
"hiccup," sometimes by a full freeze.

## React Native's two-thread architecture

The single most important concept in RN animation performance.

### The JS thread

Your JavaScript runs here: React reconciliation, component logic,
`useState`, `useEffect`, network handlers. It is a single thread (Hermes
engine or JavaScriptCore). If it's busy for 50 ms because you're parsing a
big JSON blob, every frame in that window is delayed.

### The UI thread (native main thread)

Native rendering, layout, gesture recognition, the platform's animation
loop. Independent of the JS thread.

### How they communicate

The "bridge" — historically a serialized async message queue between
threads. Now, with the New Architecture (JSI, Fabric), the boundary is
direct C++ calls instead of bridge serialization. But the threads are still
separate.

### Why this matters for animation

If you animate by calling `setState({ scale: ... })` 60 times a second:

1. JS thread does the state update.
2. JS thread runs React reconciliation.
3. JS thread serializes the new style props.
4. Cross-thread message sent to UI thread.
5. UI thread receives, applies, paints.
6. Repeat 60×/sec.

Every animation frame is bottlenecked on the JS thread being awake and
responsive. If the user types in a text field at the same time, or a
network request resolves, JS thread is busy and the animation stutters.

If you animate by changing `Animated.Value` (the legacy Animated API) or
`useSharedValue` (Reanimated):

1. JS thread sets the initial value.
2. UI thread (or worklets thread) runs the animation loop independently.
3. JS thread does whatever else it wants.
4. Animation never stutters from JS busyness.

This is why "use the animated APIs" is doctrine.

## Why Reanimated worklets exist

Reanimated 2+ introduced _worklets_: small functions that run on the UI
thread instead of the JS thread. A worklet is identified by the
`'worklet'` directive at the top of the function body, or by being passed
to a Reanimated hook that runs its argument on the UI thread.

```ts
const animatedStyle = useAnimatedStyle(() => {
  "worklet";
  return { transform: [{ scale: scale.value }] };
});
```

The `useAnimatedStyle` body is a worklet. It runs on the UI thread every
frame, reading shared values, returning new styles. The JS thread is not
involved in the per-frame work. This is how Reanimated animates smoothly
even when the JS thread is busy.

### What can run in a worklet

- Plain math, plain JavaScript.
- Reading and writing shared values (`scale.value`).
- Calling other worklets.
- Calling `withSpring`, `withTiming`, `withSequence`, etc.
- `runOnJS(jsFunction)(args)` — to call back into the JS thread.

### What can't run in a worklet

- React state, `useState`, `useEffect`.
- Console.log (well, it works but goes through a special path).
- Most React Native APIs that aren't explicitly worklet-safe.
- Closures over non-worklet functions.

### Common worklet mistakes

- **Capturing a React state value inside a worklet.** It snapshots once and
  never updates. Use shared values for any mutable state the animation
  reads.
- **Calling a non-worklet function inside a worklet.** Error: "JavaScript
  function cannot be called on UI thread." Wrap with `runOnJS`.
- **Mutating a JS object inside a worklet.** Doesn't propagate back to JS.
  Use `runOnJS` to push the update.

## What's expensive in React Native rendering

A non-exhaustive list of the things that cost frame budget:

### Layout passes (Yoga)

Anytime the layout tree changes, Yoga recalculates positions. Layout passes
are O(n) on the size of the changed subtree. Animating _layout_ properties
(width, height, padding, margin, position) triggers layout passes every
frame.

Animating _transform_ properties (translate, scale, rotate, skew) does not
trigger layout. The GPU just transforms the already-laid-out pixels.

**Rule.** Animate transforms, not layout. If you must change layout,
animate the change via `LayoutAnimation` (a one-shot) or Reanimated's
`Layout` transitions, not by setting layout style 60×/sec.

### Shadow rendering

iOS shadows (`shadowColor`, `shadowOffset`, etc.) are GPU-cheap when static.
They become expensive when the shadowed view is animated (especially
scaled), because the shadow must be re-rasterized.

If you're animating a shadowed card and seeing jank, consider:

- Pre-rasterizing the shadow as an image.
- Hiding the shadow during the animation, fading it back in at the end.
- Using `elevation` (Android) and a `View` with `shadowOpacity` (iOS)
  whose `opacity` is animated separately from the card.

### Border radius on animated views

Animating a view with a non-zero `borderRadius` requires the GPU to clip
each frame. Cheap on flagship devices, costly on mid-tier Android.

If you're animating a rounded card aggressively (FAB morph, hero
transition), watch for jank specifically here.

### Images during scale animation

Bitmap images bilinearly upscale during a scale animation, which is fine.
But upscaling a 2048-pixel image to its display size while also scaling it
from 0.8 → 1.0 forces the image to re-sample every frame.

Use appropriately-sized image assets. Don't lean on the CPU to downsample
large images while animating them.

### `react-native-svg` complex paths

SVGs with many paths or filters can become expensive when animated. The
`AnimatedCheckmark` in OCRecipes is fine — it's one stroke. A complex
illustrated SVG with 30 paths, animating a property on each, will janks
mid-tier devices.

### `react-native-blur`

Blur is GPU-expensive. A static blur of the entire screen is fine. A blur
that's animated (radius changing, or moving across the screen) is one of
the heaviest things you can do in mobile UI. Use sparingly.

### `react-native-reanimated` `withRepeat`-without-end

Infinite repeats don't pause when the screen unmounts unless you cancel
them explicitly. If you leave a shimmer running on a screen that's
backgrounded, you're burning frame budget every frame for no visible
benefit.

Cancel animations on unmount via `cancelAnimation(sharedValue)` in
`useEffect`'s cleanup, as `useSuccessAnimation.ts` does in the project.

## Hermes and the JS thread

OCRecipes ships with Hermes (the default Expo SDK 54 JS engine). Compared
to JavaScriptCore, Hermes:

- Boots faster (ahead-of-time bytecode compilation).
- Has lower memory usage.
- Generally executes faster in steady-state.

For animation purposes, the takeaway is just: don't pretend Hermes
performance buys you the right to do JS-thread animations. Hermes is faster
than JSC but still slower than UI-thread worklets.

## Profiling: where the time actually goes

### React Native Performance Monitor

In Expo dev builds, shake the device → "Show Perf Monitor." You see:

- **RAM usage** (less critical for animation)
- **JS thread fps** (target 60)
- **UI thread fps** (target 60)
- **Views count**

If UI fps stays at 60 but JS fps drops during an animation, the animation
is on the JS thread. Move it to a worklet.

If UI fps drops during an animation, something heavy is happening on the UI
thread — usually layout, shadows, complex paint work.

### Flipper

Set up a Flipper desktop client + the React Native plugin. The Flipper
"Performance" plugin gives you a frame-by-frame breakdown. Heavier to set
up; richer data. For a hobby project, the in-app Perf Monitor is usually
enough.

### Hermes profiler

Record a Hermes performance trace, open in Chrome DevTools' performance
tab. Shows JS function-level timing. Useful for chasing a "why is the JS
thread busy" question. Less directly useful for animation tuning.

### Physical device, not simulator

The iOS simulator runs animations faster than even the fastest iPhone. The
Android emulator runs them slower. Neither is the truth.

Profile on:

- The cheapest iPhone you support (iPhone SE 2 or 3 is a common floor).
- A mid-tier Android (Pixel 6a, Samsung A-series). The dirt-cheap Android
  market is too varied to chase, but mid-tier is the realistic baseline.

### Don't forget the cold case

The first time a screen renders, JS is busy bundling, parsing, mounting.
Animations on first-render are harder to keep at 60 fps than animations
later in the session.

For OCRecipes, the _home screen_ on cold launch is the highest-jank-risk
moment. Skeleton-first-then-real-content is a strategy here: cheap
placeholders that don't trigger expensive layout while the real data is
fetching, then a stagger reveal once it's all measured.

## The Reduce Motion fallback also helps performance

When `reducedMotion` is on, you skip the per-frame animation work entirely.
The screen still gets to the right state, but with one instant transition
instead of 16 frames of work.

On low-end Android specifically, _most_ animations could be substituted
with their reduced-motion fallback and the app would feel snappier overall.
If you ever ship a "low-performance mode" toggle, it's `reducedMotion + 1`
— a settings switch that flips the same `reducedMotion` gate on every
animation. You already have the infrastructure.

## A short checklist before shipping any animation

1. **Is the animation on the UI thread?** Look at the code — does it use
   `setState` (bad) or `useSharedValue` / `Animated.Value` (good)?
2. **Are you animating transforms or layout?** Layout = slow. Transform =
   fast. If layout, can you switch to transform?
3. **Profile on the slowest physical device.** Perf Monitor on, watch UI
   fps. Anything below 58 is a fail.
4. **Does it cancel on unmount?** Run the animation, navigate away
   mid-flight, navigate back. Does the next mount work? Does memory leak?
5. **Reduce Motion off vs on.** Both paths work and settle to the same
   state?
6. **Cold launch + animation.** Force-close the app, open, immediately
   trigger the animation. Does it still hit 60?
7. **Background tab.** Trigger the animation, switch to another tab, come
   back. Still works?
8. **Repeated triggers.** Tap the trigger 5 times fast. Does the animation
   handle it (cancel-and-restart, queue, debounce)?

If all eight pass, you're done.
