# 04 — Platform conventions (iOS HIG + Material 3)

The single biggest cheat code in mobile UI is to use the motion vocabulary
the user already knows. Both Apple and Google have spent millions of
person-hours teaching users what their system motions mean. When you reuse
those motions, you don't pay for the user's learning curve. When you
override them, you do.

This file is a distilled tour of what each platform's motion language _is_,
when to align with it, and the small set of times when overriding it is the
right call.

## iOS Human Interface Guidelines — motion

Apple's motion philosophy across iOS is four things: _authentic, purposeful,
quick, optional_.

### Authentic — physics, not curves

iOS motion is physics-based almost everywhere. Springs and inertia, not
cubic-beziers. The Notification Center pulls down with rubber-band
resistance at the edges. Scroll views overshoot and bounce back. Modal
sheets land with a tiny spring overshoot.

When you build a custom motion on iOS that uses a `cubic-bezier` timing
curve where users expect physics, it reads as "this app wasn't made by
people who care about the OS." Springs are almost always more native-feeling
on iOS.

### Purposeful — every motion communicates something

iOS motion always reflects a state change. There are no decorative
animations in the system UI. Even the parallax wallpaper has a job (depth
perception).

A practical implication: don't add motion just because there's space. If
nothing about the user's state changed, nothing should move.

### Quick — the system is fast

iOS animations are short by default. The nav push is ~350 ms. The modal
sheet is ~280 ms. The tab swap is instant (no animation). The keyboard rise
is ~250 ms. Anything custom that's slower than these reads as "the app is
slower than the OS."

### Optional — Reduce Motion is a first-class setting

When the user enables Reduce Motion in Settings > Accessibility > Motion,
the OS reduces or removes parallax, zoom-and-rotate transitions, the dock
genie effect, the home-screen page change. Apps are expected to do the
same. See [06-accessibility.md](./06-accessibility.md).

### The iOS motion vocabulary

The motions users have already learned from the system:

#### Navigation push/pop

Right-to-left slide for push, reverse for pop. ~350 ms. Backed by the swipe-
from-left-edge gesture. React Navigation's native stack uses this by
default — don't override unless you have a specific reason.

#### Modal sheet (formSheet / pageSheet)

Slides up from the bottom, settles with a small overshoot. Detents
(half-height, full-height) since iOS 15. Swipe-down to dismiss with rubber
band.

#### Full-screen modal

Slides up from the bottom, covers the screen entirely. Used for "task"
flows where the previous context shouldn't be visible. OCRecipes' scan
screen uses this correctly.

#### Context menu (long-press)

Underlying content blurs and scales down slightly; menu rises up. Press
duration ~400 ms before activation. Haptic on activation.

#### Switch toggle

Spring snap between off and on. The track color crossfades while the thumb
slides. Distinct haptic. Don't reinvent — `Switch` is a system component.

#### Rubber band scroll

Drag past the content edge, the content follows with diminishing returns
(rubber band). Release, springs back. Built into every scroll view.

#### App switcher

Pinch-to-shrink from the home screen, cards in a 3D stack. The motion
language of "this app is a card in a deck" pervades iOS.

#### Pull-to-refresh

Drag-down past threshold, spinner appears at the top of the list, spinner
sticks while the request runs, spinner fades when done.

### When to override iOS conventions

Rarely. The cases:

- **Brand transitions on a hero moment.** Your app's first-launch
  onboarding can have a signature motion. Stripe and Headspace do this
  well. After onboarding, conform.
- **Domain affordances the system doesn't have.** A pull-down-to-scan
  gesture, a hold-to-record button. These have no system analog; design
  your own and document it.
- **Camera UI.** The iOS Camera app itself has a distinct motion vocabulary
  (mode wheel, shutter button shrink, capture flash). If you're building a
  camera screen, study the system camera, not the system everything-else.

## Material Design 3 motion

Google's Material 3 motion system (M3, released 2021) is the spiritual
successor to Material Design's earlier motion work. It's the most
comprehensive published motion system in the industry.

### M3's six core ideas

#### 1. Easing tokens

Four named curves. Use these, not arbitrary bezier values.

- **Standard** (cubic-bezier(0.2, 0, 0, 1)) — most things
- **Emphasized** (cubic-bezier(0.2, 0, 0, 1) but tuned differently) —
  major transitions
- **Standard Decelerate** (cubic-bezier(0, 0, 0, 1)) — incoming elements
- **Standard Accelerate** (cubic-bezier(0.3, 0, 1, 1)) — outgoing elements

#### 2. Duration tokens

Three buckets, each with sub-tokens for finer control.

- **Short** (50–200 ms) — small components, selection states
- **Medium** (250–400 ms) — sheets, dialogs, expansions
- **Long** (450–700 ms) — full-screen transitions, complex transforms

#### 3. The four transition patterns

The biggest M3 contribution. Every screen-to-screen or container-to-container
transition is one of these four.

##### Container transform

A surface morphs from one position/size to another, often becoming a new
screen. The classic example: a card on a list expanding into a detail screen.
The card's content (image, title) translates and scales while the surrounding
layout dissolves.

This is what M3 calls the "hero" pattern. It's the same idea as iOS shared-
element transitions, just with a different name.

##### Shared axis

Two screens at the same hierarchy level swap, sliding on the same axis (X
for horizontal nav, Y for vertical, Z for forward/back in a flow).

##### Fade through

Two unrelated screens swap. Outgoing fades out; incoming fades in slightly
later (offset of ~90 ms so they don't both occupy opacity > 0 at the same
moment).

##### Fade

The simplest: an element appears or disappears in place via opacity. Used
for overlays, scrims, ephemeral elements like toasts.

#### 4. Motion-as-system

M3 treats motion as a design token, like color or type. Tokens are named,
versioned, themeable. The whole system stays internally consistent because
every motion comes from the same set of tokens.

OCRecipes does this lightweight: `client/constants/animations.ts` is the
project's motion-token file.

#### 5. Hero motion

Big, important, slow. Used once per screen to anchor the user's attention.
Recipe-card → recipe-detail would be a hero in OCRecipes. The shared-axis
nav between two settings pages would not.

#### 6. Reduced motion

M3 has a documented "reduced motion" specification. Crossfade is the
default substitute for any container transform or shared-axis transition.

### Full M3 motion reference

https://m3.material.io/styles/motion/overview — worth reading once. The
"transitions" section is especially useful.

## When platforms disagree

iOS and Android (M3) actually agree on most things — both lean physics-
based, both forbid bouncy easing, both require Reduce Motion. The visible
disagreements:

### Tab transitions

- iOS: tab swap is instant. No content animation.
- M3: tab swap fades through (subtle).

React Navigation does iOS-style by default. Don't fight it on iOS, don't
add a fade-through on Android unless you're also matching the rest of
Material precisely.

### Modal sheet

- iOS: spring up, rubber-band dismiss, detents.
- M3: bottom sheet with similar feel but different visual treatment
  (handle, scrim opacity).

React Native: use `react-native-bottom-sheet` or React Navigation's modal
sheets. Don't roll your own.

### Switch toggle

- iOS: spring snap, color crossfade, thumb shadow.
- M3: longer slide, no thumb shadow, color shift in icon.

Use `Switch` — RN renders the platform-appropriate version.

### Long-press context menu

- iOS: blur background, scale content, haptic, menu rises.
- M3: less elaborate, no blur, menu rises faster.

If you build a custom context menu, lean iOS-style on iOS, M3-style on
Android. The platform-specific code splits are worth it for this one.

## Camera-specific UI conventions

OCRecipes is a camera-based app. Camera UI has its own conventions, mostly
established by the system camera apps and Snapchat/Instagram.

### Shutter button

A large, central, white circle. Tap to capture. Holds may trigger video on
some apps; in a barcode/label scanner like OCRecipes, hold has no use.

Animation: scale down briefly on press (~0.92), springy. Flash the screen
briefly on capture (50–100 ms opacity flash on a white overlay).

### Capture flash

A brief screen-wide white opacity flash signaling capture. Even when the
hardware flash is off, the visual flash is the "yes, photo taken" feedback.
Without it, users tap again because they're not sure it worked.

### Live overlay

Anything that updates in real-time over the camera feed (barcode detection
brackets, label edge detection, focus reticle). Should update at 30–60 fps
and use minimal opacity (~30%) so it doesn't obscure the subject.

### Mode wheel

Horizontal scrolling list of capture modes (Photo / Barcode / Receipt /
Label in OCRecipes' case). Should snap-scroll with haptic on each mode
change.

### Result preview overlay

After capture, a thumbnail of the captured image floats up to a "review"
position. The user can tap to review or swipe to dismiss. This is the
single hardest pattern in camera UI to get right; the iOS Camera roll
thumbnail is a good reference.

### What camera UI should NOT do

- **No long entrance animations on the camera screen itself.** Users open
  the camera to capture _something happening now_. The viewfinder should
  be live in < 200 ms from button tap.
- **No swipe-up gesture conflict.** Many photo apps use swipe-up to reveal
  settings; iOS uses swipe-up for Control Center. The lower 30% of the
  screen is unsafe for vertical gestures.
- **No motion that obscures the subject.** All overlays should be in the
  edges or transparent.

## Practical decisions for OCRecipes

Given iOS HIG + M3 + camera conventions and the project's existing setup:

### Default to iOS native motion

React Native + Expo on iOS gets native modal sheets, native nav push, native
keyboards. Use them. Don't override.

### Use Material durations as a sanity check

If your motion is faster than M3's _short_ (50–200 ms) it's probably too
fast. If it's slower than M3's _long_ (450–700 ms) it's probably too slow.

### Camera screen: minimal motion

The scan screen should be lively (real-time barcode detection brackets) but
not animated for animation's sake. Reserve motion for capture feedback and
result transitions.

### Shared-element on the hero

Recipe-card → recipe-detail is the candidate for a hero shared-element
transition. It's the moment in the app most worth the polish. Other
nav transitions: use the platform default.

### Match the brand register

OCRecipes' visual identity (warm cream backgrounds, terracotta accents,
Poppins, food/craft) suggests medium-paced, springy-but-not-bouncy motion.
Don't lean into "snappy productivity" tightness. Don't lean into "playful
game" bouncy overshoot. Hit the middle.
