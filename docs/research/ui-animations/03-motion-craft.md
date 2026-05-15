# 03 — Motion craft: timing, easing, choreography

The principles tell you _whether_ to animate. The catalog tells you _what_
to animate. This file is about _how the animation should feel_ — the curve,
the duration, the way one motion follows another. This is the part that
separates "an app with animations" from "an app that feels alive."

## Duration: the most important number

Most "this animation feels off" complaints are about duration, not easing.

### The reference table

| Category             | Duration     | Examples                                              |
| -------------------- | ------------ | ----------------------------------------------------- |
| Micro (state flip)   | 50–100 ms    | toggle, checkbox, color shift, press feedback         |
| Short (small move)   | 150–250 ms   | toast, tooltip, popover, chip select, tab pop         |
| Medium (most things) | 250–350 ms   | modal sheet, nav push, accordion expand, swipe-reveal |
| Long (big spatial)   | 400–600 ms   | full-screen modal, shared-element zoom, FAB morph     |
| Extended (delight)   | 600–1200 ms  | success checkmark draw, number ticker, confetti       |
| Background loop      | 1500–2500 ms | shimmer, breathing, ambient pulse                     |

### Calibration rules

- **Same path, half the duration on mobile.** Web animations published in
  design articles often quote 400–500 ms for things that should be 200–250 ms
  on a phone. Mobile screens are smaller and reaction time matters more.
- **Same path, longer on entrance than on exit.** Entrances need to be
  noticed; exits don't. A modal that opens in 300 ms can close in 200 ms.
- **Faster on repeat.** The second time the user does the same action in
  the same session, ~70% of the first duration feels right. Most apps don't
  bother, and you usually don't either, but if a flow is highly repeated
  (multi-step scan, batch capture) it's worth considering.
- **Don't beat the OS to the punch.** Your modal can't open faster than the
  system modal underneath without looking janky. ~280 ms is the iOS sheet
  baseline.

### How to pick

Start with the table. Animate it. Watch it on a physical device. Adjust by
±50 ms increments. The difference between 250 and 300 ms is perceptible; the
difference between 250 and 260 ms isn't. Don't fuss below 50 ms granularity.

## Easing: the curve, not the duration

Easing is the function that maps elapsed time (0 → 1) to progress (0 → 1).
Linear is `progress = time`. Everything else is more interesting.

### The four curves that cover 95% of cases

#### Standard / `Easing.inOut(Easing.cubic)`

Slow start, fast middle, slow end. Symmetric. The default for _most_
"unimportant" transitions — content swaps, opacity fades.

Material calls this _standard easing_ (cubic-bezier(0.4, 0, 0.2, 1)).

#### Decelerate / `Easing.out(Easing.cubic)`

Fast start, slow end. Things that _enter_ the screen. The eye catches the
fast initial move and the gentle settle reinforces "I've arrived."

Material: _decelerate_ (cubic-bezier(0, 0, 0.2, 1)).

OCRecipes uses this in `expandTimingConfig` and `contentRevealTimingConfig`.

#### Accelerate / `Easing.in(Easing.cubic)`

Slow start, fast end. Things that _exit_ the screen. The slow start hides
the start of the dismissal under the dismiss gesture's natural pause; the
fast end makes the exit feel decisive.

Material: _accelerate_ (cubic-bezier(0.4, 0, 1, 1)).

OCRecipes uses this in `collapseTimingConfig` and `toastExitTimingConfig`.

#### Emphasized / `Easing.bezier(0.2, 0, 0, 1)`

Slower at both ends than standard, with more middle speed. Used for the
_most important_ transitions — nav push, modal sheet up, shared element.
It's the curve Material 3 introduced specifically to give "hero" transitions
extra presence.

### Mistakes to avoid

- **Don't use the same curve for entrance and exit.** They communicate
  different things.
- **Don't use linear for anything except infinite loops** (shimmer, spinner)
  where the start/end matter less than the consistency of the loop.
- **Don't use bounce easing on UI.** Bounce works for cartoon characters
  and breaks the illusion of professional polish on a productivity app. Use
  springs (next section) when you want a small overshoot.

## Springs: physics, not curves

Spring animations are defined by physics — _mass_, _stiffness_, _damping_ —
not by a duration. The animation runs until the system reaches equilibrium.

### Why springs feel different

A timing-based animation has a fixed end frame. If the start point changes
mid-animation (the user taps again), you have to cancel and restart, often
with a visible jolt.

A spring continues toward its target with momentum. If the target changes
mid-animation, the spring smoothly adjusts. This is why springs feel
"alive" — they respond to interruptions like a real object.

For any animation that the user might trigger again mid-flight (press
feedback, drag-release, toggle), prefer a spring.

### The three knobs

#### Damping

How quickly the oscillation dies out. Low damping = lots of bounce. High
damping = no bounce at all (critically damped or overdamped).

- **damping: 10–14** — playful, visible bounce
- **damping: 15–20** — natural, light overshoot
- **damping: 20–30** — settled, minimal overshoot
- **damping: 40+** — no perceptible overshoot

#### Stiffness

The spring constant. Higher stiffness = faster motion. Think of it as "how
strong the rubber band is."

- **stiffness: 50–100** — slow, ambient
- **stiffness: 100–200** — most UI interactions
- **stiffness: 200–400** — snappy, responsive
- **stiffness: 400+** — almost instant

#### Mass

How heavy the object is. Higher mass = slower acceleration, more inertia.

- **mass: 0.2–0.5** — light, snappy
- **mass: 0.8–1.2** — natural feel
- **mass: 1.5–3** — heavy, deliberate

### Reading the OCRecipes spring configs

From `client/constants/animations.ts`:

```ts
pressSpringConfig:    { damping: 15, mass: 0.3, stiffness: 150, overshootClamping: true }
// → snappy press feedback, no bounce (button shouldn't visibly overshoot)

toastSpringConfig:    { damping: 20, mass: 0.4, stiffness: 200 }
// → quick settle, mild overshoot, toast lands and stays put

tabIconPopConfig:     { damping: 12, mass: 0.4, stiffness: 200, overshootClamping: false }
// → playful bounce on tab focus — overshoot is intentional, says "you tapped it"

successPopConfig:     { damping: 12, mass: 0.3, stiffness: 200, overshootClamping: false }
// → bouncy, scale pop. The low mass + low damping = bigger overshoot
```

The pattern: when overshoot is _the point_ (delight, "I noticed your tap"),
keep damping low and `overshootClamping: false`. When overshoot would feel
wrong (a press that should look like the button is depressed, not bouncing),
clamp it.

### How to design a spring

1. Decide: should it overshoot? (delight → yes, mechanical → no)
2. Start with the project's closest existing config.
3. Animate.
4. If too fast → lower stiffness or raise mass.
5. If too bouncy → raise damping.
6. If too "dead" → lower damping.

Don't tune three knobs at once. Move one, watch, move the next.

## Choreography: when multiple things animate together

A page has multiple animated parts. They have to coexist.

### The 5 rules of choreography

#### 1. One thing leads

The largest, most important motion starts first. Supporting motion follows
50–100 ms later. A modal sheet rising up is the lead; the background dim is
the secondary, starting 50 ms behind.

#### 2. Stagger small things, batch big things

A list of cards: stagger by 30–60 ms per item, cap at ~6 items. A page with
a hero card, a chart, and a list: don't stagger them at all — they're three
different "things," each one animates as a unit.

#### 3. Same axis, same time

If two elements both move on the X axis, they should animate together (same
duration, same easing). If they move on different axes (one X, one Y), they
can be independent.

#### 4. Hierarchy in duration

The most important element has the longest, most-eased motion. Background
elements use shorter, simpler animations. A FAB morph is 400 ms; the
background dim behind it is 250 ms.

#### 5. Never compete for the eye

Two equally-prominent animations on screen at the same time fight for
attention. The user's eye flickers and they remember neither. If you have
two animations, sequence them or make one clearly secondary (smaller,
shorter, simpler).

### Stagger math

For a list of N items with delay D between items, the user perceives the
stagger if:

- N ≤ 6 and D = 30–80 ms → reads as "items appearing in order"
- N > 6 and D > 50 ms → reads as "slow loading"
- N > 10 → don't stagger. Reveal as a block.

Total stagger duration target: 200–400 ms. If `N * D > 400`, lower D.

OCRecipes' `speedDialStaggerDelay = 50` and 2–4 mini-FABs gives 100–200 ms
total — right in the pocket.

## Shared element transitions and FLIP

When the same element appears in two places and should "morph" between
them. The most magical transition technique and also the most demanding.

### The FLIP technique (concept, not specific library)

Coined by Paul Lewis, the canonical approach to "same element, different
position":

1. **F**irst — Record the element's starting bounds (x, y, width, height).
2. **L**ast — Move it (synchronously) to its ending position. Record those
   bounds.
3. **I**nvert — Apply a transform (translate, scale) to make it _look like_
   it's still in the starting position.
4. **P**lay — Animate the transform back to identity (no transform), and
   it visually slides/scales to its real end position.

The trick: the layout move is instant; only the visual transform animates.
Transforms are cheap (GPU); layout is expensive (CPU + measure pass). FLIP
sidesteps the expensive part.

### In React Native

Two viable approaches:

#### Approach 1: Reanimated 4 `sharedTransitionTag`

```tsx
// On the source screen:
<Animated.View sharedTransitionTag="recipe-hero-42" />

// On the destination screen:
<Animated.View sharedTransitionTag="recipe-hero-42" />
```

React Navigation + Reanimated coordinate the transition. Less control,
fastest to ship.

#### Approach 2: Hand-rolled FLIP

Measure source position via `measure()` in a `useAnimatedRef`. Stash the
measurement on the destination screen's mount. On mount, set
`useSharedValue` to the source position. `withSpring` to the target (0).

More control, more code. Worth it for the hero moment of an app (recipe
detail entrance).

### When NOT to do shared-element

- The "same" element is actually two different aspect ratios (a square
  thumbnail and a wide hero). Morphing aspect ratios visibly distorts.
- The transition is between non-navigation states (tab swap, modal swap).
  These are too fast to perceive the morph.
- Performance budget is tight. Hand-rolled FLIP is GPU-friendly but
  measure-on-mount adds a frame.

## Anticipation and follow-through in UI

Disney's principles in practice.

### Anticipation: the pre-move

Before a button "pops" to confirm a success, it can dip down slightly first.
Before a modal launches, the trigger button can scale up by 2–3%. Before
content slides in from the right, the screen can briefly slide left by
~4 px.

The point: the eye knows _something is about to happen_ and arrives at the
right place when it does.

Use sparingly — anticipation that's too obvious feels theatrical. The dip
before a pop is 80–100 ms and 2–4% deep.

### Follow-through: the overshoot

After motion stops, parts of the object can keep moving briefly. In UI,
this is what spring physics give you for free. A modal that springs up
overshoots by a few pixels before settling. A toggle handle that snaps to
the on position briefly oscillates.

`overshootClamping: false` on a spring is your follow-through control.

## Easing in code, the OCRecipes way

When you write a new animation in OCRecipes:

1. Check `client/constants/animations.ts` first. The project already has
   `pressSpringConfig`, `expandTimingConfig`, `collapseTimingConfig`,
   `contentRevealTimingConfig`, `toastSpringConfig`,
   `toastExitTimingConfig`, `tabIconPopConfig`, `successPopConfig`,
   `successFlashConfig`. If your case fits one, use it.

2. If your case is new and reusable, add a new config there with a clear
   JSDoc explaining when to use it. Don't inline magic numbers in
   components.

3. If your case is genuinely one-off (a single screen, a single moment),
   inline a `WithTimingConfig` literal in the component file with a comment
   explaining the choice.

4. Don't reach for `Easing.linear`. Don't reach for `withTiming` without
   an `easing` field. Either is a sign you reached for the wrong default.

5. Don't tune your animation on the simulator only. The simulator is faster
   than the slowest device you ship to. Test on an actual mid-tier Android
   phone if you can; failing that, test on the oldest iPhone you have.

## A debugging checklist for "this animation feels off"

Walk it in order:

1. **Duration.** Too long or too short? Try ±50 ms.
2. **Easing.** Right curve for the direction (entrance/exit)?
3. **Spring vs timing.** Could this thing be interrupted? Use a spring.
4. **Overshoot.** Does the overshoot match the personality (mechanical vs
   playful)?
5. **Start state.** Does the animation start where the eye is already
   looking, or somewhere off-screen the user has to find?
6. **End state.** Does it settle, or does it leave the user wondering if
   another frame is coming?
7. **Choreography.** Are other animations competing for the eye at the same
   moment?
8. **Frame rate.** Profile. Drops > 0 mean the animation is wrong, not just
   "feels off."
9. **Reduce Motion.** Did you test with it on? Half of "feels off" reports
   come from the wrong fallback.
