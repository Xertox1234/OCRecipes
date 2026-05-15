# 02 — Micro-interactions catalog

A _micro-interaction_ is a single, contained moment of communication between
the app and the user. Tap a heart, the heart fills. Pull down a list, a
spinner appears. Long-press a chat bubble, a reaction tray slides in. Each
one is small enough to fit in your head whole, and the quality of a
product is largely the sum of the quality of its micro-interactions.

The book this whole field uses as a starting point is Dan Saffer's
_Microinteractions_ (2013). Its model is still load-bearing.

## Saffer's four-part model

Every micro-interaction has these four parts. When one feels off, the
diagnosis usually starts with "which part is broken."

### 1. Trigger

What initiates the interaction. _User triggers_: tap, long-press, drag,
swipe, scroll past threshold, shake, voice. _System triggers_: timer fires,
network event arrives, state crosses a threshold, geolocation changes,
notification received.

**Design questions.** Is the trigger discoverable? Is the affordance visible
without being garish? Are competing triggers in conflict (e.g., a
swipe-to-dismiss row inside a horizontally-scrolling list)?

### 2. Rules

What the interaction is allowed to do, and what it does in response to the
trigger. Includes the state machine, the edge cases, the rate limits.

**Design questions.** What happens on rapid repeat triggers (debounce?
queue? cancel-and-restart?). What happens during loading? What happens when
the network fails mid-interaction?

### 3. Feedback

How the user knows what's happening. Visual (motion, color, content),
auditory (system sounds, custom tones), haptic (tap, success, warning).

**Design questions.** Is the feedback immediate (under 100 ms)? Is it
proportional (a tap gets a small response, a milestone gets a big one)? Does
it survive Reduce Motion? Is it accessible to screen readers?

### 4. Loops and modes

What happens over time and across repetitions. Does the interaction get
faster the more times you use it? Does it adapt to context? What's the
"empty" state, the "full" state, the "error" state?

**Design questions.** What does the 1000th interaction feel like? (Most
micro-interactions are designed for the first one and feel grating on the
hundredth.) Are there modes the user can be in that change the rules
(e.g., bulk-select mode in a list)?

## The catalog

Patterns are grouped by _what they do for the user_, not by visual style.
Each entry has: **what** it is, **when** to reach for it, **how** it's
typically built, and **OCRecipes notes** where relevant.

### Feedback patterns — "yes, I heard you"

#### Press feedback

**What.** A tappable element visibly responds to the press itself, before
the action completes.

**When.** Every tappable element, period. iOS adds it automatically for
system buttons; for custom Pressables you have to add it.

**How.** Scale to 0.96 on press-in, back to 1.0 on press-out. Use
`pressSpringConfig` from `client/constants/animations.ts`. Tie to
`onPressIn`/`onPressOut`, _not_ `onPress` — the user needs feedback the
moment their finger lands.

**OCRecipes notes.** Use a `Pressable` with `useSharedValue` + `withSpring`.
Don't use the default `Pressable` opacity — it's too subtle on cream
backgrounds. The scale + a 4% darken on `style` is the project default.

#### Selection feedback

**What.** A non-press tactile blip when the user changes a discrete value
(picker tick, radio button, segmented control).

**When.** Pickers, segmented controls, switches, radio groups.

**How.** `useHaptics().selection()` — already wired up. Visual: a
50–100 ms color flash or scale pop.

#### Loading skeleton

**What.** A placeholder shaped like the eventual content, often with a
shimmer animation pulsing across it.

**When.** Content that will arrive in 150–2000 ms. Below 150 ms, skip the
skeleton — it'll flash and disappear, which is worse than a brief blank
moment. Above 2000 ms, add a "Still loading" message at 1500 ms or change
strategy (paginate, optimistically render, etc.).

**How.** Static placeholder rectangles tinted slightly darker than the
background, with a moving linear gradient sweeping left-to-right every
~1.5 s. Reanimated `useSharedValue` + `withRepeat(withTiming)`.

**OCRecipes notes.** Use `Colors.{theme}.backgroundSecondary` for the
skeleton fill, a shimmer with `withOpacity(Colors.{theme}.backgroundTertiary,
0.6)` as the highlight. Disable shimmer under reducedMotion — leave the
static placeholder.

#### Pull-to-refresh

**What.** Drag the top of a scrollable list down past a threshold to refresh.

**When.** Lists where the data could be stale (chat threads, feeds, recipe
browser results, scan history).

**How.** Built-in `RefreshControl` on `FlatList`/`ScrollView` is sufficient
for 95% of cases. Custom variants (e.g., a custom illustration that grows as
you pull) are a delight-tier investment and only worth it on the home/landing
list of the app.

#### Toast

**What.** A brief, non-blocking message confirming or warning about a
recent action.

**When.** Confirming a save, warning about a non-fatal failure, surfacing a
background event. Don't toast errors that require user action — use a modal
or inline message.

**How.** Slide in from the top (or bottom; pick one and stick to it), live
for 2–4 seconds, slide out. Allow swipe-to-dismiss. Allow tap-to-action.

**OCRecipes notes.** Already implemented in `client/components/Toast.tsx`
with `SlideInUp.springify()`, `Gesture.Pan()` for dismiss, and
`toastSpringConfig`/`toastExitTimingConfig`. Reuse it.

#### Inline validation

**What.** A field shows an error or success state as the user types or on
blur.

**When.** Forms with format constraints (email, password, food weight). Show
on blur for typing-friendliness; show on submit-attempt for finality.

**How.** A subtle color shift on the border, an icon swap, a brief shake on
submit-with-errors. Shake is 4 horizontal moves of 8 px in ~250 ms — easy to
overdo.

### Continuity patterns — "this is the same thing, just elsewhere"

#### Shared element transition

**What.** A single visual element (hero image, title, color block) appears
in two screens, and animates from one position to the other during
navigation.

**When.** Master-detail navigation where the detail screen _zooms into_ an
item from the master list. Card-to-full-recipe is the canonical example.

**How.** React Native has a few approaches:

- `react-native-shared-element` (community lib, mature but maintenance-mode)
- `react-native-reanimated`'s `sharedTransitionTag` + `SharedTransition` API
  (Reanimated 4)
- Hand-rolled FLIP technique (see
  [03-motion-craft.md](./03-motion-craft.md))

**OCRecipes notes.** The recipe-card → recipe-detail flow is a strong
candidate. The scan-result → nutrition-detail flow is another. Start with
Reanimated 4's `sharedTransitionTag` since it ships with the project's
existing dependency.

#### Modal sheet presentation

**What.** A view slides up from the bottom, covering part or all of the
screen, dismissable by swipe-down or tap-outside.

**When.** Temporary tasks (scan, quick log, photo intent, edit profile).
Anything where the user's previous context should remain mentally present.

**How.** Built-in via React Navigation `presentation: "modal"` or
`"formSheet"`. Use `"fullScreenModal"` for tasks that need the full screen
(scan, photo capture).

**OCRecipes notes.** The RootStackNavigator already uses these correctly.
When adding a new modal, prefer `formSheet` on iOS 15+ for partial-height
sheets (less visually heavy than fullScreenModal).

#### Tab transition

**What.** The active tab changes; content swaps; the tab indicator slides.

**When.** Bottom-tab navigation. Already built into React Navigation.

**How.** Don't reinvent. The icon pop on tab focus (`tabIconPopConfig`) is
the OCRecipes house touch and it's enough.

#### Hero zoom

**What.** Tapping a card expands it into a full-screen view; the card's
content scales/translates to its full-screen position.

**When.** Photo galleries, recipe cards, anything image-heavy where the
image is the headline.

**How.** A specific case of the shared-element transition; the implementation
is the same.

### Hierarchy patterns — "look here"

#### Stagger reveal

**What.** A list of items animates in one after another, with a small delay
between each (~30–80 ms).

**When.** First-render of a list, list refresh, or a major state change
that brings new items in. Don't stagger on every scroll — it's exhausting.

**How.** `FadeInUp.delay(index * 50).springify()` in Reanimated 4. Cap at
~6 items — beyond that, the later items feel slow to arrive.

**OCRecipes notes.** Already used in `SpeedDial.tsx`. The `speedDialStaggerDelay = 50`
constant is the project default. Use the same for new lists. Larger items
(recipe cards) can tolerate 60–80 ms; smaller items (chips, tags) want 30–40
ms.

#### Spotlight (highlight pulse)

**What.** A new or relevant element briefly highlights — a subtle scale up,
a background flash, or a colored border that fades.

**When.** Onboarding ("tap here to scan"), feature discovery, success
acknowledgment ("your goal was updated").

**How.** `withSequence(withTiming(highlight, 200), withTiming(normal, 600))`.
Once per appearance — never loop.

#### Empty state animation

**What.** A small loop or one-shot animation on an otherwise-empty screen
(no scans yet, no chats yet, no meals logged today).

**When.** Empty states that the user will hit early in their lifecycle.
Late-lifecycle empty states (cleared inbox) don't need it.

**How.** A simple SVG illustration with one Reanimated property (rotation,
opacity pulse, or floating). Lottie animations are also fine but heavier.

**Apply sparingly.** This is a delight-tier feature, not a feedback one.

#### Scroll-driven header

**What.** The header shrinks, color-shifts, or pins-to-top as the user
scrolls.

**When.** Long content screens (recipe detail, profile, settings) where the
header takes up valuable real estate.

**How.** `useAnimatedScrollHandler` + `useSharedValue` on the scroll Y,
interpolate to header height/opacity. Cap interpolation to avoid the header
becoming unreadable.

### Affordance patterns — "you can do this here"

#### FAB morph

**What.** A floating action button transforms into a sheet, modal, or full
screen when tapped. The morph visually says "this button became this view."

**When.** The "scan" FAB on the home tab — already a strong candidate for
this in OCRecipes.

**How.** Animate the FAB's position, size, and corner radius simultaneously
to the final view's bounds. The icon inside crossfades to the new content.
Implement via shared-element or hand-rolled FLIP.

**OCRecipes notes.** The current scan FAB launches a full-screen modal
without a morph. Adding the morph would be a delight-tier upgrade — file an
opportunity in [09-ocrecipes-opportunities.md](./09-ocrecipes-opportunities.md).

#### Speed dial / mini-FAB stagger

**What.** A FAB taps to reveal 2–5 mini-FABs, each labeled, that stagger in.

**When.** A single FAB that needs to expose multiple actions without going
to a separate screen. Some OCRecipes flows might use this (e.g., a "quick
add" FAB exposing Scan / Quick Log / Receipt).

**How.** Already implemented in `client/components/SpeedDial.tsx`. Reuse.

#### Swipe-to-reveal-actions

**What.** Dragging a row left or right reveals action buttons (delete,
archive, favorite).

**When.** List items that need 2–3 secondary actions without cluttering the
visible row.

**How.** Already implemented as `SwipeableRow.tsx` in the project. Uses
`Gesture.Pan()` with `swipeActionThreshold = 80`. Under reducedMotion, the
project falls back to inline buttons instead — that pattern is worth keeping
on any new swipe surface.

#### Drag-and-drop reorder

**What.** Long-press a list item to "pick it up," drag to a new position,
release to drop.

**When.** Meal plan reorder, recipe steps reorder, custom lists.

**How.** `react-native-draggable-flatlist` or hand-rolled with Reanimated +
Gesture Handler. The scale-up on pickup (~1.05) and the shadow growth are
the affordance — without them, the user doesn't know they've picked it up.

#### Long-press menu

**What.** Press-and-hold reveals a context menu, often with a haptic.

**When.** Power-user actions that don't deserve UI real estate. iOS context
menus on Messages, Photos.

**How.** `Gesture.LongPress()` with a 400–500 ms threshold. Trigger
`useHaptics().impact("Heavy")` on activation. The menu itself springs up
with a brief blur on the underlying content.

### Delight patterns — "this app has personality"

Use sparingly. One per screen, at most.

#### Success checkmark draw

**What.** A green checkmark self-draws (stroke animates from 0 to full) over
~400 ms, often with a haptic and a background flash.

**When.** Confirming a meaningful save (meal logged, scan complete, goal
hit). Not on every form submit.

**How.** Already implemented in `client/components/AnimatedCheckmark.tsx`
using SVG `strokeDashoffset` animated via `useAnimatedProps`. Reuse.

#### Number ticker

**What.** A numeric value (calorie total, count, score) doesn't pop to its
new value — it counts up over ~600 ms.

**When.** Score-like values that the user is invested in (daily calories,
protein, streak counter). Not on every counter.

**How.** Reanimated `useSharedValue` + `useDerivedValue` interpolating to a
formatted string in `useAnimatedProps`, applied to an `Animated.Text` or
similar.

**OCRecipes notes.** Could be applied to the daily nutrition rings on the
home screen when meals are logged. The "count up" reinforces the feeling of
progress. Don't use it on resting numbers — only on the post-action update.

#### Heart pop / favorite

**What.** Tapping a heart fills it AND pops it to 1.4× scale, then springs
back.

**When.** Favoriting a recipe, liking a meal, double-tap to favorite.

**How.** `useSuccessPop` is already exported from
`client/hooks/useSuccessAnimation.ts`. Reuse.

#### Confetti / celebration burst

**What.** A short burst of particles on a major milestone (first scan,
streak milestone, weight goal hit).

**When.** Rare moments. Once per occurrence. Never on daily events.

**How.** `react-native-confetti-cannon` or hand-rolled SVG burst. Cap
duration at 1.5 s. Pair with a haptic and a sound (if app has sound).

#### Custom loader

**What.** A loading state that's specifically branded — a tiny recipe-card
icon spinning, a coffee cup steaming, etc.

**When.** Predictable, repeated loads on the same screen. Don't bother for
one-off loads — the cost-benefit doesn't pay off.

**How.** SVG + Reanimated rotation/opacity. Keep under 50 KB asset weight.

## Patterns to _not_ invent

These get reinvented constantly and almost always badly.

- **Custom animated keyboards.** The system keyboard is what users know.
- **Custom scroll physics.** The OS scroll feel is calibrated; you will not
  improve on it.
- **Background carousels that auto-advance.** Users hate them.
- **Continuous "breathing" buttons on the main CTA.** Feels nervous,
  competes for attention.
- **Onboarding screens that animate so slowly the user can't skip them.**
- **Modal entrances longer than 400 ms.** Feels broken on the second use.

## The catalog as a checklist

When you sit down to add motion to a feature, scan this list and ask: which
existing pattern is the closest match? Almost always, the answer is "one of
these, with the project's existing config." That's the fastest path to a
good result and the easiest one to review.
