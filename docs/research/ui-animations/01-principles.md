# 01 — Principles of motion design

Animation is the difference between an interface that feels like a slideshow
of static screens and one that feels like a _thing_ — a connected, responsive
material the user is manipulating. Done well, motion is invisible: the user
doesn't notice it any more than they notice that a real-world drawer slides
open instead of teleporting. Done poorly, motion is the first thing they hate.

This file is the _why_. Read it once. Internalize the five jobs and the
anti-patterns. The rest of the research folder is the _how_.

## The five jobs motion does

Almost every legitimate UI animation is doing one or more of these. If you
can't name which job, the animation probably shouldn't exist.

### 1. Orientation — tell me where I am and how I got here

When a screen pushes from the right on iOS, the user knows they're going
"deeper" and can swipe back. When a sheet slides up from the bottom, they
know it's modal and they can dismiss it down. When a tapped tab icon bounces,
they know which one is now active.

Without motion, every navigation event is teleportation. Teleportation forces
the user to re-parse the whole screen from scratch. Motion lets them keep
their mental map.

**OCRecipes example.** The scan modal uses `fullScreenModal` presentation —
it animates up from the bottom. That's not decoration. It says "this is
temporary, swipe down to leave, the home screen is still there underneath."

### 2. Feedback — yes, I heard you

When the user taps something and nothing visible happens for 80 ms, they tap
again. Then they wonder if the app is broken. A 100 ms scale-down on press
(`pressSpringConfig` in `client/constants/animations.ts`) costs almost
nothing and erases that doubt.

Feedback is the smallest, highest-value category of animation. Almost every
interactive element should have it. The micro-interactions catalog
([02-micro-interactions-catalog.md](./02-micro-interactions-catalog.md)) is
mostly feedback patterns.

### 3. Continuity — same thing, new place

A user opens a recipe card from a list. The card expands into a full screen
showing the same hero image, title, and meta. If the hero teleports, the user
has to recognize the recipe again. If it animates from card-position to
hero-position (a _shared element transition_), the user's eye never breaks
contact. They know it's the same recipe; they're just seeing more of it.

Continuity is what makes an app feel like one connected space instead of a
deck of cards.

### 4. Hierarchy — what matters here

Stagger reveals say "look here first, then here, then here." A new chat
message bubbles in while older ones stay still — the new one is salient
without being shouted. A skeleton placeholder pulses to say "this region is
loading, the rest of the page is real."

Motion controls attention. A page where everything animates at once is
indistinguishable from a page where nothing does.

### 5. Delight — this app has personality

The smallest, most carefully-rationed job. A success checkmark that
self-draws. A heart that pops oversize before settling. A pull-to-refresh
that becomes a custom illustration. Done sparingly, delight is what users
remember and tell their friends about. Done constantly, it's exhausting and
slow.

Rule of thumb: at most one delight beat per screen, on the moment that most
deserves to feel rewarded (success states, milestone unlocks, first-time
completions).

## The six anti-patterns

If your animation falls into any of these, cut it.

### Decorative motion

Animation added because "it looked empty." If removing it costs nothing,
remove it. The user's time is more valuable than your portfolio shot.

### Motion that blocks interaction

A 600 ms entrance animation where the buttons can't be tapped until it
finishes. The user's intent arrived before your animation did. Either start
the buttons interactive immediately, or shorten the animation. Material's
guidance: navigation transitions should peak under 300 ms; nothing should
block input for more than 500 ms total.

### Motion that lies

A loading spinner that's secretly a fake (no actual request in flight) so the
app "feels substantial." A success checkmark that animates before the network
call returns. Users learn the lie and stop trusting any of your motion.

### Motion that draws attention to the wrong thing

A button that bounces continuously on the home screen. A "new!" badge that
pulses forever. Anything that competes with the user's actual task. If it's
animating, it's saying _look here_. Make sure that's what you mean.

### Motion that ignores reduced motion

Roughly 1 in 25 users — vestibular sensitivity, post-concussion symptoms, age
— turn on the OS "Reduce Motion" setting. If your screen-shifting parallax
makes them nauseous, they will uninstall. See
[06-accessibility.md](./06-accessibility.md). The fix is cheap:
`useAccessibility().reducedMotion` is already wired up project-wide.

### Motion that costs frames

A 250 ms layout animation that drops frames on a mid-tier Android device is
worse than no animation. Jank reads as broken. The 16.67 ms budget is real;
profile if you're not sure. See [05-performance-and-jank.md](./05-performance-and-jank.md).

## The Disney 12, reframed for UI

Disney's animation principles are 90 years old and were written for hand-drawn
characters, but the perceptual truths transfer. Here are the ones that matter
for mobile UI.

### Squash and stretch

Real objects deform under force. A button that scales to 0.96 on press and
back to 1.0 on release "squashes." Without it, the button feels glassy and
dead.

**Apply when:** any tappable element. The amount is small —
0.95–0.98 is enough. Anything more and the element starts to feel rubbery.

### Anticipation

Before a big move, a small move in the opposite direction. A jumping
character crouches first. A modal that's about to slide up might briefly dip
down. A success checkmark that's about to pop scale-flashes the background.

**Apply when:** the user is about to see a major state change and you want to
draw their eye to where it'll happen.

### Slow in, slow out — _easing_

Real objects don't start and stop at full velocity. They accelerate and
decelerate. Linear motion in UI feels mechanical; eased motion feels alive.
This is the single most important Disney principle for product design.

**Apply when:** every animation. See
[03-motion-craft.md](./03-motion-craft.md) for the actual curves.

### Follow-through and overlapping action

Different parts of an object don't all stop at the same time. A character's
cape keeps moving after they stop. A modal that springs up overshoots by a
few pixels before settling.

**Apply when:** spring physics are usually right. Reanimated's `withSpring`
gives you follow-through for free if `overshootClamping` is `false`. The
project's `tabIconPopConfig` does exactly this.

### Arcs

Real motion travels on arcs, not straight lines. A FAB morphing into a sheet
shouldn't slide on a straight diagonal — it should arc.

**Apply when:** anything moving more than ~100 px across the screen. For
shorter moves, the arc is below perceptual threshold and a straight line is
fine.

### Secondary action

A primary motion is supported by smaller motions elsewhere. A modal slides up
(primary) while the background dims (secondary). A toast appears (primary)
while the FAB slides up to make room (secondary).

**Apply when:** you have a major state change that has knock-on effects.
Choreograph the supporting motion to start slightly _after_ the primary so
the eye follows the lead.

### Timing

The duration and rhythm of motion change its character. The same path covered
in 80 ms vs 400 ms says different things — the first is "snappy and
mechanical," the second is "heavy and considered."

**Apply when:** matching the personality of the brand. Cooking-warmth-friendly
OCRecipes leans medium-slow (200–300 ms) over snappy. See
[03-motion-craft.md](./03-motion-craft.md) for duration tables.

### Exaggeration

Caricature reads better than realism. A success pop that's exactly 1.0× isn't
seen. One that's 1.4× registers. One that's 2.0× looks broken.

**Apply when:** delight moments. The project's `successPopConfig` peaks at
1.4× — calibrated for visibility without breaking.

### Appeal (the catch-all)

The motion has personality consistent with the product. OCRecipes is warmth,
food, slow craft. Its motion vocabulary should lean springy-but-not-bouncy,
medium durations, soft easing. A productivity app's motion should be tighter.
A game's looser. Pick a register and stay in it.

## Material Motion and Apple HIG — the corporate distillation

Google and Apple have each written multi-page treatments of UI motion. The
shortest possible summaries:

### Material Design 3 motion

- **Durations:** short (50–200 ms) for small things, medium (250–400 ms) for
  most things, long (450–700 ms) for big spatial transitions only.
- **Easing:** four named curves — _standard_ (most things), _emphasized_
  (key transitions like nav), _accelerate_ (exits), _decelerate_ (entrances).
- **Transitions:** _container transform_ (one element morphs into another —
  card-to-detail), _shared axis_ (peer-to-peer screens slide on the same
  axis), _fade through_ (unrelated content swaps), _fade_ (overlays).
- The full ref: https://m3.material.io/styles/motion/overview

### Apple Human Interface Guidelines — motion

- **Authentic, not flashy.** Mirror real-world physics. Springs, not arbitrary
  curves.
- **Purposeful.** Communicate something every time. Don't decorate.
- **Optional.** Respect Reduce Motion. Crossfade is the default fallback.
- **Quick by default.** iOS system animations are short. A custom modal sheet
  shouldn't be slower than the OS sheet.
- The full ref: https://developer.apple.com/design/human-interface-guidelines/motion

### What both agree on

- Easing curves are not interchangeable. Entrances decelerate (start fast,
  settle), exits accelerate (start slow, leave fast).
- Symmetry usually loses. The same easing in and out feels wrong.
- Motion should never be the only way to communicate state. Color, position,
  text — at least one of these must carry the meaning without animation.
- Reduce Motion is non-negotiable.

## The decision protocol

When you're about to add an animation, ask in this order:

1. **Which of the five jobs is it doing?** If you can't name one, stop.
2. **What's the existing pattern?** Most things you'd invent already have a
   name and a config. See
   [02-micro-interactions-catalog.md](./02-micro-interactions-catalog.md) and
   `client/constants/animations.ts`.
3. **What's the reduced-motion path?** Write it before the motion path.
4. **Does the state settle correctly if the animation is interrupted?** If a
   user navigates away mid-flash, does the shared value reset on unmount?
5. **Is it on the UI thread?** Reanimated worklets run on UI thread; setState
   does not. See [05-performance-and-jank.md](./05-performance-and-jank.md).
6. **Have you actually felt it on a physical mid-tier device?** Simulator
   smoothness lies.

The protocol takes about 30 seconds once it's habit. It catches 90% of the
bad animations before they reach a diff.
