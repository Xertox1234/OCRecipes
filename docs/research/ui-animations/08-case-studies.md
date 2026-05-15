# 08 — Apps to study (case studies)

The fastest way to develop taste for animation is to study apps that do it
well, with specific things in mind to notice. This file is a curated list
of apps worth opening with your phone to your face, paired with what you
should be looking for in each.

For each app: _why it matters_, _what specifically to notice_, and _how it
maps to OCRecipes_.

## Stripe (iOS app)

**Why it matters.** Stripe's mobile app is the canonical example of
"calm precision" — restrained motion that earns trust for a financial
product. The animations are small, predictable, and convey state changes
flawlessly.

**What to notice.**

- _Number tickers_ on the dashboard. Account balance, daily volume — these
  numbers count up smoothly when the data refreshes. Note how the
  digits roll: not all at once, slightly staggered.
- _Pull-to-refresh_ spinner is custom but minimal — a Stripe-logo-shaped
  loader. Note the duration: it stays _just_ long enough that the
  network call completes before the spinner ever feels stuck.
- _Success checkmark on payment confirmation._ Self-draws over ~600 ms.
  Pairs with a green background flash and a haptic.
- _Card flip on switching environment_ (Live ↔ Test). The page literally
  flips on the Y axis. This is the _one_ hero animation in the app — and
  it's reserved for a moment that's psychologically significant (you're
  about to charge real money).

**Maps to OCRecipes.**

- The number ticker on the home screen calorie/protein/carb totals when
  meals are logged. The user wants to see the number _change as a result
  of their action_, not just appear.
- The success checkmark pattern on scan completion. OCRecipes already has
  `AnimatedCheckmark`. The Stripe lesson: pair it with a brief green
  background flash and a haptic, not just the stroke draw alone.

## Headspace (iOS & Android)

**Why it matters.** Headspace built an entire brand around motion. The
"breathing" loop animation has been studied and copied for a decade.
Their illustration-driven motion vocabulary is the gold standard for
"warm, calming, slow."

**What to notice.**

- _Breathing animation_ during meditation. A circle expands and contracts
  with the breath pacing (~4s in, 4s out). It's not just decorative —
  it's a _guide_ for the user's actual breath. Motion as utility, not
  ornament.
- _Onboarding mascot transitions._ Each onboarding screen has a custom
  illustration that gently bobs or rotates. Loops are slow (2–3 seconds)
  so they never feel anxious.
- _Page transitions on the home screen._ Smooth, springy, never abrupt.
  Easing is heavy on the slow-out.
- _Streak counters that celebrate_. When the user hits a streak
  milestone, a brief animated burst (not confetti — soft particles) plays
  once. After dismissal, the streak number is just there, static. No
  permanent celebration.

**Maps to OCRecipes.**

- _Empty state animations._ The "no meals logged today" home screen could
  benefit from a small Headspace-style illustration with a slow, ambient
  loop — much warmer than a static graphic.
- _Onboarding pacing._ Slow, considered. The user is being asked to set
  goals and connect health data — a calm motion register helps the
  emotional weight of that.

## Things 3 (iOS)

**Why it matters.** Things 3 (Cultured Code) is perhaps the most
animation-obsessed productivity app on iOS. Every interaction has a
considered motion response. It's worth keeping on a phone just for
reference.

**What to notice.**

- _The "Magic Plus" button._ A floating plus button that you can _drag_
  into the list to specify exactly where the new task goes. The button
  follows your finger with springy physics. As you drag it over a
  position, the surrounding tasks part slightly to make room. This is
  shared-element + gesture + physics all in one.
- _Check-off animation._ When you tap a checkbox, the checkmark draws on,
  the task title strikes through (animated, not instant), and the row
  slides up (springy) into the "completed" section. ~600 ms total. Long
  for a check-off, but the choreography means you _see_ the task go
  somewhere — closure.
- _Swipe-to-defer._ Drag a task to the right, a "later" affordance
  appears, release past threshold and the task vanishes with a calendar-
  page-flip animation.
- _Header collapse on scroll._ Subtle but present — header shrinks to give
  more room for content.

**Maps to OCRecipes.**

- _Check-off pattern for meal logging._ When the user marks a meal as
  logged, the meal item's appearance changes. Things 3's lesson: animate
  the transition, don't snap it. The user wants to _feel_ they did
  something.
- _Drag-to-reorder for meal plan._ The Magic Plus pattern is overkill,
  but the same physics-based "items part to make room" interaction
  applies to meal plan day reordering.

## Duolingo (iOS & Android)

**Why it matters.** Duolingo built a billion-dollar product partly on
motion. The mascot reactions, the lesson-complete celebrations, the
streak flame — all motion-driven. It's the canonical example of using
animation for emotional reinforcement.

**What to notice.**

- _Mascot reactions._ Every state change (right answer, wrong answer,
  lesson complete) has a Duo-the-owl reaction. Wrong answer: he covers his
  eyes briefly. Right answer: he smiles and bounces. Lesson complete: a
  full celebration. Note: the reactions are _short_ — most under 1 second
  — so they never block progress.
- _The XP bar fill animation._ When you earn XP, the bar fills with a
  slightly elastic motion and the number ticker increments. Always
  satisfying. Always the right duration.
- _Streak flame._ The streak counter on the home screen has a slow,
  ambient flicker — like a candle flame. The motion is subtle but it's
  _alive_, which makes the streak feel like a living thing the user is
  feeding.
- _Hearts shake when lost._ On wrong answer, the heart icon shakes (small
  horizontal oscillation) before being marked as lost.

**Maps to OCRecipes.**

- _Logging milestone celebrations._ First scan, 7-day streak, 30-day
  streak — these deserve Duolingo-style celebrations. _Once each._ Not on
  every meal log.
- _Errors as character._ The Duolingo approach to errors (mascot reaction,
  small shake, but the user moves on) is gentler than a red border and a
  scolding message. Even a small "oops" motion on a barcode scan failure
  reads more friendly than a hard-edged error toast.

## Snapchat (iOS & Android)

**Why it matters.** Snapchat is the canonical mobile camera-UI app and
the source of most modern camera interaction patterns. Even people who
don't use Snapchat regularly should study its camera screen.

**What to notice.**

- _Shutter button affordance._ Tap to take a photo. Hold to record video.
  The shutter scales down on press, and during a hold, an animated
  progress ring grows around it. Multiple affordances on one button, all
  motion-communicated.
- _Mode swipe._ Horizontal swipe across the screen switches between modes
  (Camera, Chat, Stories). The transition uses a parallax effect — modes
  feel like sheets of paper sliding past each other.
- _Capture flash._ Brief white opacity flash on capture confirms photo
  taken. Without it, users would re-tap.
- _Lens (filter) carousel._ The filter selector below the shutter button
  has snap-scroll, haptic on each lens change. Each lens has a small
  enter animation as it becomes active.
- _Recording wave._ While recording video, a circular wave animation
  pulses outward from the shutter button. Persistent feedback that
  recording is happening.

**Maps to OCRecipes.**

- _Scan screen affordances._ OCRecipes' scan screen could borrow Snapchat's
  shutter-on-press shrink, the capture flash, and the on-detection visual
  feedback. If a barcode is detected, a brief brackets-pulse plus haptic
  before the actual capture would make the detection moment feel
  real-time and trustworthy.
- _Mode wheel (if the project ever adds it)._ Snap-scroll between
  Barcode / Label / Receipt / Photo scan modes.

## Cash App (iOS & Android)

**Why it matters.** Cash App is the canonical "haptic-led design" app.
Every meaningful interaction has a calibrated haptic. The visual motion is
intentionally restrained so the haptic can do more of the talking.

**What to notice.**

- _Send money confirmation._ The bottom action button slides up, a
  success ripple goes through the screen, a strong haptic fires. The
  ripple is brief — under 500 ms — and the haptic is _the_ memorable part.
- _Card-flip on showing the Cash Card details._ Same as Stripe's flip,
  used for a moment of psychological significance (your card number is
  about to be revealed).
- _Pull-to-refresh feels like resistance._ Custom physics — the pull has
  a "weight" to it. You feel like you're pulling against something
  real. This is high-craft work and easy to get wrong.
- _Color changes feel haptic._ When you change the color theme of your
  Cash card, the whole screen morphs to the new color with a haptic on
  arrival. Color + motion + haptic, perfectly synced.

**Maps to OCRecipes.**

- _Haptic-led scan capture._ The current capture probably has a soft
  feedback. Cash App's lesson: make it deliberate. Heavy haptic on
  successful capture; medium on detection; light on tap. Each one a
  different tactile signature.
- _Color-led goal achievement._ When a daily goal is hit (calories,
  protein), a brief color theme shift across the goal card, with a
  notification haptic. The color change carries the meaning; the haptic
  confirms it; the motion is minimal.

## Instagram (iOS & Android)

**Why it matters.** Instagram normalized the _double-tap-to-heart_
interaction and the heart-pop animation. Worth studying for the heart
specifically, plus its pull-to-refresh and story tap interactions.

**What to notice.**

- _Double-tap-to-heart._ A huge red heart pops out of the center of the
  image, scales up to ~2× then springs back to ~1.2× then fades. The
  scale arc is what makes it feel celebratory rather than mechanical.
- _Heart icon fill._ When you tap the small heart icon in the action bar
  (not the double-tap), it pops to ~1.4× and the fill color shifts from
  outline to red. The pop is what registers — the color change alone
  wouldn't.
- _Pull-to-refresh._ Custom Instagram-logo spinner. Note how the spinner
  is _centered on the camera icon_ in the top bar, so the user's eye
  tracks naturally from "I pulled" to "something's happening."
- _Story tap progress._ The horizontal progress bar at the top of a
  story has a linear-fill animation matching the story duration. Pause
  the story (long-press) and the progress pauses too. Resume — it
  continues from where it paused.

**Maps to OCRecipes.**

- _Heart pop on favoriting a recipe._ Already mapped via `useSuccessPop`.
- _Double-tap-to-favorite on recipe cards._ The Instagram gesture is a
  good fit — a recipe card user might want to favorite without
  navigating to the action button.

## Apollo for Reddit (now defunct, but reference videos abound)

**Why it matters.** Christian Selig's Apollo app was famous for motion
craft on iOS. Worth searching YouTube for tear-down videos.

**What to notice.**

- _Upvote / downvote spring._ Arrow icons that "spring" up or down on tap
  with a satisfying overshoot. Pair with a haptic.
- _Comment expansion._ Tap a comment thread, the thread expands with a
  layout animation; the parent comment stays static so you don't lose
  orientation.
- _Image preview gesture._ Long-press a thumbnail, the image lifts off
  the screen on a 3D-ish elevation lift, with a blur behind it.
- _Custom pull-to-refresh._ A bouncy Reddit-alien character that gets
  pulled along with the gesture.

**Maps to OCRecipes.**

- _Vote spring pattern_ applies to _any_ tap-to-mark interaction —
  marking a meal as favorite, marking a goal as achieved, etc.

## Notion (iOS & Android)

**Why it matters.** Notion is a good study for _restraint_. With so many
features and complex hierarchies, the team has aggressively limited
motion to avoid overwhelming. Read it as "the floor of acceptable."

**What to notice.**

- _Block drag-and-drop._ Long-press a block, it lifts; drag, surrounding
  blocks part; release, it snaps into place. Same Things 3 pattern but
  more restrained.
- _Page navigation._ Standard iOS nav push, no custom transition. The
  app's complexity is enough — adding more motion would compound it.
- _Slash-command menu._ Type "/", a menu appears below your cursor with
  no entrance animation (just opacity fade). Fast, focused, doesn't
  block your typing flow.

**Maps to OCRecipes.**

- _When you can't justify motion, don't add it._ Notion's lesson is the
  inverse of Duolingo's — sometimes the most considered choice is to
  stay still.

## Apps to specifically NOT copy

Worth naming a few patterns you'll see in popular apps that are _not_ worth
copying:

- **Auto-advancing carousels** (still common on banking and shopping apps).
  Universally hated.
- **Background-video onboarding** that you can't skip. Slow to load,
  expensive on battery.
- **Anything that bounces continuously on the main screen** — a "new!"
  badge that pulses forever. Attention vampires.
- **Modal entrances longer than 400 ms.** Feels broken on the second use.
- **Heavy parallax on the home screen.** Especially on lower-end phones,
  this is the single biggest source of nausea complaints.

## How to study an app like a designer

When you open one of these apps:

1. **Make your phone slow.** Settings → Developer → Animation duration
   scale 1.5× or 2× (Android), or use the iOS Accessibility setting to
   slow down system animations. Now you can see the choreography
   frame-by-frame.
2. **Try to identify Saffer's four parts.** Trigger / rules / feedback /
   loops. Where are they? Are they obvious?
3. **Try the reduced-motion path.** Toggle Reduce Motion in OS settings.
   See what they substitute. Note: many apps substitute _nothing_ (i.e.,
   the change is instant). Some substitute a crossfade. Very few do
   custom reduced-motion paths. Most apps get away with crossfade.
4. **Try with VoiceOver on.** Tap on each animated element and see what
   the screen reader says. Often you'll discover that the animation
   conveys information that's _missing_ from the screen reader path —
   a small accessibility lesson.
5. **Watch the app idle.** What animates without the user doing anything?
   If a lot is moving on an idle screen, the app is anxious. If nothing is
   moving but the screen still feels alive, the static design is doing
   the work.

## A specific exercise

Open Stripe, Headspace, Cash App, and Things 3. Spend 10 minutes in each,
paying attention only to the motion. Then close all four and write down,
without checking, the _first three motion moments_ you remember from each.
Those are the moments their designers got right. The dozens of motions you
didn't remember are the ones that were appropriately invisible.

When you build OCRecipes animations, aim for the same ratio: one or two
moments per screen that earn memory, and a lot of small ones that disappear.
