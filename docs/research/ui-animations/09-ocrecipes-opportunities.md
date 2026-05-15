# 09 — OCRecipes-specific animation opportunities

The previous files are the general theory. This file is the _map_: a list
of specific places in OCRecipes where motion would do meaningful work, with
the technique, the priority, and the reasoning behind each.

Treat this as a backlog, not a manifesto. Pick a few; ignore the rest. The
goal is to know which moves are _worth_ implementing, not to implement
them all.

## Priority tiers

- **🟢 P0 — Foundational.** Probably worth doing soon. Either low-effort
  high-impact, or repairs a current bad pattern.
- **🟡 P1 — Polish.** Real benefit, more effort. Pick one or two.
- **🟣 P2 — Delight.** Hero moments, rare events. One per quarter at most.

Each entry below has: **the move**, **what it solves**, **technique**,
**effort**, and the **priority tier**.

## Scan flow

The scan flow is the app's signature interaction. Every motion choice here
is high-leverage — users go through it constantly.

### 🟢 P0 — Barcode-detected pulse

**The move.** When the camera detects a barcode in frame, the four corner
brackets pulse outward briefly (scale 1.0 → 1.15 → 1.0 over ~250 ms) and a
_light_ haptic fires.

**What it solves.** Currently, barcode detection happens silently — the
user can hold the camera over a barcode for a moment without realizing the
app has seen it. The pulse provides confidence that the detection is
working and prepares the user for the imminent capture.

**Technique.** A `useSharedValue` on the bracket scale, driven from the
barcode-detection callback via `runOnJS`. `useHaptics().impact("Light")`.
Use the project's existing `expandTimingConfig` for the outward, then
`collapseTimingConfig` for the settle.

**Effort.** ~30 min. Existing brackets just need a sharedValue and a
trigger.

### 🟢 P0 — Capture flash

**The move.** Brief screen-wide white opacity overlay (0 → 0.4 → 0) over
~150 ms on successful capture, paired with a medium haptic.

**What it solves.** Cameras have done this since the analog flashbulb era.
Without it, users tap-to-capture twice because they're not sure the first
tap registered.

**Technique.** A full-screen `Animated.View` with `opacity` shared value,
absolutely positioned over the camera feed (below the close button so the
user can still dismiss). `withSequence` of two `withTiming` calls.

**Effort.** ~20 min.

### 🟡 P1 — Shutter button shrink on press

**The move.** The shutter button scales to 0.92 on press-in, springs back
on press-out. Mirrors what Snapchat / iOS Camera do.

**What it solves.** Tactile presence. The button currently has only opacity
feedback (RN Pressable default). Scale feedback feels more committed.

**Technique.** `pressSpringConfig` on a sharedValue. `onPressIn` /
`onPressOut`.

**Effort.** ~15 min. Could be a reusable `PressableScale` component.

### 🟣 P2 — Scan-result thumbnail float

**The move.** After a successful scan, a small thumbnail of what was scanned
floats from the center of the camera preview up to a position in the
top-right corner ("review later" area). User can tap it to inspect, or it
fades after 3 seconds.

**What it solves.** Continuity between "I just captured this" and "here's
where to find it." Currently the user has to navigate to history to find
the scan; the floating thumbnail makes the location of the artifact
visible.

**Technique.** Hand-rolled FLIP — measure source position (camera
preview center), measure target position (top-right tray), animate
translateX, translateY, scale via withSpring. After 3 seconds, fade out
with `withTiming(0, { duration: 300 })`.

**Effort.** ~3 hours. Requires UI changes (new "review tray" location).

## Home screen — nutrition rings & daily summary

The home screen is the user's daily destination. Small motion makes it
feel alive without distracting from glanceability.

### 🟢 P0 — Number ticker on meal log

**The move.** When a meal is logged, the day's calorie, protein, carb, fat
totals tick up to their new values over ~600 ms with `Easing.out(cubic)`.

**What it solves.** Connection between user action (log a meal) and result
(updated totals). Currently the totals just snap to the new value, which
feels disconnected — the user has to mentally check if the number actually
changed.

**Technique.** Snippet 7 from `07-reanimated-patterns.md` (NumberTicker
component using `AnimatedTextInput`). Triggered when the relevant tanstack-
query data updates.

**Effort.** ~1 hour for the reusable component + wiring.

### 🟡 P1 — Progress ring fill

**The move.** Daily progress rings (calories toward goal, protein toward
goal) animate from current to new value over ~800 ms when meals log. Note:
already present in the project (`ProgressRing.tsx` uses `withTiming` on
strokeDashoffset). Verify it's wired up to actually animate on meal-log,
not just on screen-load.

**What it solves.** Visualizes the contribution of the action.

**Technique.** Already in the project. Audit usage; ensure animation
fires on logging, not just on mount.

**Effort.** ~30 min audit + wiring.

### 🟣 P2 — Goal-hit celebration

**The move.** When a daily goal is hit (calories, protein, or both
together), a soft burst of color-tinted particles emits from the
relevant ring, and a strong haptic fires once.

**What it solves.** Reinforcement of the behavior the app wants to
encourage. Tied to the streak system if implemented.

**Technique.** `react-native-confetti-cannon` with a custom palette
matching the relevant nutrient accent color (calorieAccent, proteinAccent,
etc). Cap at one celebration per day per goal.

**Effort.** ~2 hours including state management for "we already
celebrated today."

## Nutrition detail screen

### 🟡 P1 — Card flip for serving size detail

**The move.** Tap a "more details" affordance on the nutrition card,
the card flips on the Y axis to reveal full nutrient breakdown on the
back.

**What it solves.** Avoids a full navigation transition for a secondary
detail view. Maintains the user's context.

**Technique.** Two animated views, one absolute-positioned over the other,
each with `rotateY` animated 0° to 180° / 180° to 0°. Use a `backfaceVisibility:
"hidden"` style to hide the back of each face.

**Effort.** ~2 hours.

### 🟢 P0 — Shimmer skeletons during nutrition fetch

**The move.** While nutrition data is being fetched (CNF → USDA → API
Ninjas pipeline can take 1–2 seconds), show shimmer skeletons matching the
nutrition card layout.

**What it solves.** Avoids a blank or spinner-only screen that feels
unresponsive. The skeleton looks like "the page is about to be filled,"
which is psychologically much better than a spinner.

**Technique.** Snippet 3 from `07-reanimated-patterns.md`. Apply to the
nutrition value cells and the macro labels.

**Effort.** ~1 hour for skeleton components + integration.

## Coach chat

### 🟢 P0 — Message bubble enter animation

**The move.** New message bubbles slide in from the bottom with a slight
fade (Y: 8 → 0, opacity: 0 → 1) over ~300 ms. Use `expandTimingConfig`
easing.

**What it solves.** Currently messages probably pop in instantly. The
slight slide reinforces "this is new content arriving."

**Technique.** `entering={SlideInDown.duration(300).springify()}` on the
message component.

**Effort.** ~15 min.

### 🟡 P1 — Typing indicator (3-dot pulse)

**The move.** While the coach is "thinking" (streaming response from the
LLM hasn't started), show three dots pulsing in sequence at the bottom of
the chat. Each dot has staggered opacity animation.

**What it solves.** Feedback that the system is working. LLM responses can
take 1–3 seconds to first token; without an indicator, users tap "send"
again.

**Technique.** Three Animated.View dots, each with a `useSharedValue` on
opacity, with `withRepeat(withSequence(withTiming, withTiming))` and a
staggered `delay()` per dot.

**Effort.** ~45 min.

### 🟢 P0 — Streaming text reveal

**The move.** As LLM tokens stream in, the text appears word-by-word (or
character-by-character) rather than all at once. This is more of an
_async pacing_ than an animation, but it's worth flagging.

**What it solves.** Stream responses feel instant. The "writing" effect
creates the illusion the coach is thinking, which makes the wait feel
shorter.

**Technique.** Probably already supported by the LLM streaming API the
project uses. If currently the text appears in chunks, switch to character-
level append. Make sure to debounce React re-renders so the JS thread
doesn't choke.

**Effort.** ~1 hour, depending on existing streaming infrastructure.

### 🟣 P2 — Suggested-reply chip stagger

**The move.** When the coach finishes a response and suggests follow-up
questions as chips below, the chips stagger in left-to-right with 50 ms
between each.

**What it solves.** Draws attention to the suggested actions in their
order of relevance.

**Technique.** Snippet 4 from `07-reanimated-patterns.md`.

**Effort.** ~20 min if suggested replies are already in place.

## Meal plan

### 🟡 P1 — Drag-to-reorder meals across days

**The move.** Long-press a meal card, it lifts (scale 1.05, shadow grows);
drag, surrounding meals part to make room; release, springs into place.

**What it solves.** Reordering is currently probably a tap-to-edit
workflow. Direct manipulation feels much more natural.

**Technique.** `react-native-draggable-flatlist` or hand-rolled with
Reanimated + Gesture Handler. The library is easier and saves a few days
of work.

**Effort.** ~4–6 hours including testing.

### 🟢 P0 — Day complete state transition

**The move.** When all meals for a day are logged, the day header (date
strip) gently transitions to a "complete" visual state — a soft green
tint, a checkmark fade-in next to the date.

**What it solves.** Visual progress at the week level. Currently the user
has to mentally aggregate "did I log everything today?" The animation
answers it before they ask.

**Technique.** Animated color interpolation on background, opacity fade
on a checkmark icon. `useDerivedValue` watching the meal-log state.

**Effort.** ~1 hour.

## Photo intent / photo analysis

### 🟢 P0 — Intent selection feedback

**The move.** When the user taps an intent option (Meal / Recipe /
Label / Receipt), the selected option scales briefly (1.0 → 1.05 → 1.0)
and a selection haptic fires.

**What it solves.** Clarity about the selected intent before the user
proceeds. Tap-then-confirm is a common pattern; visual confirmation of the
tap matters.

**Technique.** `successPopConfig` on the tapped option, `useHaptics()
.selection()`.

**Effort.** ~20 min.

### 🟡 P1 — Analysis progress with phase narration

**The move.** During photo analysis (which runs through detection, OCR,
classification phases), show a progress bar with text that updates as
phases complete: "Reading image..." → "Detecting items..." → "Looking up
nutrition...". Each phrase change fades smoothly.

**What it solves.** A multi-second wait feels longer when nothing is
narrated. Phase narration both informs and entertains the wait.

**Technique.** A `useSharedValue` on progress (0–1), an `Animated.View`
width-bound to it for the bar. Text content swaps via React state (with
crossfade Animated.View wrapping the Text).

**Effort.** ~2 hours including the phase-state machine.

## Onboarding (the 6 screens)

### 🟢 P0 — Onboarding screen transitions

**The move.** Between onboarding screens, content slides horizontally
(`shared axis X`). The persistent header (Step 2 of 6) stays static; only
the content area animates. ~300 ms with emphasized easing.

**What it solves.** Continuity between onboarding steps. Currently
probably a default nav push.

**Technique.** Custom navigator presentation or layout animations on the
content `Animated.View`.

**Effort.** ~1 hour.

### 🟢 P0 — Progress bar at top

**The move.** Animated progress bar at top of onboarding showing 1/6,
2/6, etc. The progress fills smoothly as the user advances.

**What it solves.** Reduces "how much longer?" anxiety. Onboarding
completion rate is highly correlated with perceived progress.

**Technique.** `useSharedValue` on progress percent, `Animated.View` width
bound to it via `useAnimatedStyle`.

**Effort.** ~45 min.

## Profile & settings

### 🟢 P0 — Setting toggle haptic

**The move.** Every Switch in settings fires a `useHaptics().selection()`
on toggle.

**What it solves.** Settings screens benefit enormously from haptic
feedback. Users feel in control.

**Technique.** Wrapper around Switch that calls haptics on `onValueChange`.

**Effort.** ~20 min.

### 🟡 P1 — Avatar pop on edit

**The move.** When the user taps to change their avatar, the current
avatar briefly pops (1.0 → 1.1 → 1.0) before the image picker opens.

**What it solves.** Connects the tap to the avatar specifically (vs. some
other UI element).

**Technique.** `successPopConfig` on a sharedValue.

**Effort.** ~15 min.

## Receipt scan / receipt review

### 🟡 P1 — Item-by-item reveal during OCR review

**The move.** As OCR results stream in (or finish), the recognized items
stagger in from the bottom of the receipt review screen.

**What it solves.** Long lists of OCR'd items appearing all at once is
overwhelming. The stagger naturally directs attention top-down.

**Technique.** Snippet 4 (staggered list entrance). Cap stagger at 8
items, instant past that.

**Effort.** ~30 min.

### 🟢 P0 — Confidence indicator pulse

**The move.** Items with low OCR confidence (say <0.8) gently pulse with
a warning color until the user reviews them.

**What it solves.** Direct attention to the items most likely to be
wrong. The user knows where to focus their review effort.

**Technique.** `withRepeat(withSequence)` on opacity, low frequency
(1 cycle per ~1.5 s, never more than 3 cycles before user attention).

**Effort.** ~1 hour.

## Recipe browser

### 🟡 P1 — Card-to-detail shared element transition

**The move.** Tap a recipe card → the card hero image, title, and meta
animate from card-position to full-screen detail-position. Reanimated 4's
`sharedTransitionTag` is the right tool.

**What it solves.** The single most visible "this app feels expensive"
moment. Drastically improves perceived polish of the recipe browsing flow.

**Technique.** Add matching `sharedTransitionTag={`recipe-${id}`}` to
the hero image in both the card and the detail screen. React Navigation +
Reanimated handle the rest.

**Effort.** ~2–3 hours including making sure the source and destination
aspect ratios are compatible.

### 🟣 P2 — Generate recipe AI loader

**The move.** While AI is generating a custom recipe (premium feature), a
custom loading animation runs — perhaps a stylized chef-hat-with-particles,
or a recipe card "writing itself."

**What it solves.** AI generation takes 5–15 seconds. A generic spinner
feels unbearable. A branded loader makes the wait feel intentional.

**Technique.** Lottie or SVG with Reanimated. Asset budget 50 KB.

**Effort.** ~1 day including asset creation.

## Cookbook & grocery list

### 🟢 P0 — Swipe-to-delete on list items

**The move.** Drag a grocery-list item left, a red "delete" affordance
reveals; release past threshold to delete with a fade.

**What it solves.** Direct manipulation for the most common action.

**Technique.** Project's existing `SwipeableRow.tsx` — reuse.

**Effort.** ~30 min wiring.

### 🟡 P1 — Check-off completion animation

**The move.** Tap to check off a grocery item → checkbox draws on
(self-drawing checkmark), text strikes through (animated), row gently
fades to 60% opacity and moves to the bottom of the list.

**What it solves.** Reinforces task completion. Inspired by Things 3.

**Technique.** `AnimatedCheckmark` (project component) + Layout
animation for the row's position change.

**Effort.** ~1 hour.

## Background / ambient

### 🟣 P2 — Streak flame on streak counter

**The move.** Streak counter on the home screen has a subtle flicker —
like a candle flame. Slow, low-amplitude opacity/scale loop.

**What it solves.** Makes the streak feel like a living thing the user is
feeding. Duolingo's lesson.

**Technique.** `withRepeat` on a low-amplitude `withSequence`. Cancel on
unmount.

**Effort.** ~45 min including asset adjustments.

## Selection guidance — where to start

If you have one hour, do these:

1. Capture flash on scan (P0, ~20 min).
2. Barcode-detected pulse (P0, ~30 min).
3. Number ticker on meal log (P0, ~1 hour but starts paying off
   immediately).

If you have an afternoon, add: 4. Coach chat typing indicator and message slide-in. 5. Day-complete state transition on meal plan.

If you have a week of polish: 6. Card-to-detail shared element on recipes. 7. Drag-to-reorder meals in plan. 8. Receipt OCR confidence pulse.

Save these for "delight quarter" planning:

- Goal-hit celebration.
- Scan-result thumbnail float.
- Generate-recipe AI loader.
- Streak flame.

## How to decide what NOT to do

A useful filter: would a user notice if this animation were missing? If
the answer is "no, but the app would feel slightly worse" — that's a
P0/P1 candidate. If the answer is "no, the app would feel exactly the
same" — skip it. If the answer is "yes, immediately" — that's a P2 hero
animation; consider carefully.

Most of the entries above pass the first filter. A few pass the third.
None should pass the second.
