# UI Animations & Micro-Interactions — Research Notes

A deep dive into motion design for mobile UIs, tied to the OCRecipes stack
(React Native, Expo SDK 54, Reanimated 4, Gesture Handler 2). Written as
agent-ready notes — every file is self-contained, cross-linked, and
opinionated.

The goal is not to make the app "more animated." Animation that doesn't earn
its place is jank you ship on purpose. The goal is to know exactly _when_
motion clarifies (orientation, feedback, hierarchy, continuity) and _when_ it
just distracts, then have the muscle memory to ship the first kind quickly.

## Read in order

1. **[01-principles.md](./01-principles.md)** — Why animation exists in UI.
   The five jobs motion does, the anti-patterns, the Disney 12 reframed for
   product design.
2. **[02-micro-interactions-catalog.md](./02-micro-interactions-catalog.md)** —
   Saffer's trigger / rules / feedback / loops model and a catalog of ~25
   patterns (button press, pull-to-refresh, FAB morph, swipe-to-dismiss,
   skeleton, toast, etc.).
3. **[03-motion-craft.md](./03-motion-craft.md)** — Duration, easing, springs,
   choreography, stagger, shared-element transitions, FLIP.
4. **[04-platform-conventions.md](./04-platform-conventions.md)** — iOS HIG
   and Material 3 motion vocabularies. What users already expect.
5. **[05-performance-and-jank.md](./05-performance-and-jank.md)** — The
   16.67 ms budget, JS thread vs UI thread, why Reanimated worklets exist,
   profiling.
6. **[06-accessibility.md](./06-accessibility.md)** — Reduce Motion, the
   vestibular case for it, haptics as a non-motion feedback substitute, focus
   handling.
7. **[07-reanimated-patterns.md](./07-reanimated-patterns.md)** — Reanimated 4
   mental model and copy-pasteable snippets that match OCRecipes conventions.
8. **[08-case-studies.md](./08-case-studies.md)** — Apps worth studying
   (Stripe, Headspace, Things 3, Duolingo, Snapchat, Cash App, Instagram) and
   _what specifically_ to look at in each.
9. **[09-ocrecipes-opportunities.md](./09-ocrecipes-opportunities.md)** —
   Concrete animation moves for OCRecipes screens: scan FAB morph, barcode
   capture pulse, nutrition card reveal, coach chat token stream, plan-day
   completion, etc.

## Runnable demo

The [`demo/`](./demo/) folder contains a self-contained
`AnimationLabScreen.tsx` with ~10 live examples and a wiring guide
([`demo/README.md`](./demo/README.md)). Drop the screen into the Root
navigator (one-line addition) and open it from anywhere via
`navigation.navigate("AnimationLab")` — or expose a debug button in the
profile tab. Each example is annotated with the technique, the easing/spring
choice, and a one-line "where this would fit in OCRecipes" note.

## How these notes use OCRecipes conventions

Every snippet imports from `@/constants/theme` and `@/constants/animations`,
respects `useAccessibility().reducedMotion`, and uses the project's existing
`useHaptics`, `useSuccessFlash`, `useSuccessPop` hooks where applicable. When
introducing a new pattern, the doc says explicitly whether it should be lifted
into `client/constants/animations.ts` (shared config) vs. left inline (one-off
component motion).

## What this isn't

- **Not a Reanimated reference.** The official docs are excellent and live at
  https://docs.swmansion.com/react-native-reanimated/. These notes show
  _which_ primitives to reach for _when_, not how each one works.
- **Not a design system.** OCRecipes already has one in
  `client/constants/theme.ts`. These notes layer motion on top of that.
- **Not a tutorial.** The demo is a tutorial. These notes are the map.

## How to use this as an agent

If you're an LLM agent asked to add an animation to OCRecipes:

1. Read **01-principles.md** to decide whether the animation should exist.
2. Read **02-micro-interactions-catalog.md** to find the existing pattern
   name. Most things you'd build already have a name.
3. Read **03-motion-craft.md** for timing/easing choice. Reach for the
   configs already in `client/constants/animations.ts` before adding new ones.
4. Read **07-reanimated-patterns.md** for the snippet shape.
5. Cross-check **06-accessibility.md** — every animation needs a
   `reducedMotion` path. Haptics stay on. State always settles correctly even
   when motion is skipped.
