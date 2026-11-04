# Teaching people the camera, voice and import — design

**Status:** agreed with the owner in chat, 2026-10-29/30. Replaces the Home "Discover" carousel.

## Why

OCRecipes does its best work when people let it do the typing: point the camera at a barcode, label,
receipt or menu, speak when the camera can't help, and import recipes instead of retyping them. New users
default to the keyboard. Today the app tries to teach this with the Home "Discover" carousel: up to ten
gradient "✨ Try this" cards in one place, away from where the work happens. The owner finds it out of place
and wants features taught **in context, at the moment they help**.

## The owner's decisions

- **What to push, in order:** camera first; voice where the camera can't help; import for recipes. Typing
  is the fallback and is never promoted. (Voice is missing on many typing screens today — that is its own
  todo, `todos/P2-2026-10-29-voice-input-where-camera-is-missing.md`, not part of this work.)
- **How:** tooltips placed where the feature lives, well-timed toasts with a button, and suggested prompts
  in the Coach.
- **Frequency:** each tip shows **once**, or never if the person already uses that feature. **At most one
  tip per screen visit.**
- **Discover goes away entirely.** The **For You** section moves to the top of Home in its place.
- **Design:** the current design stays (`client/constants/theme.ts`, existing components). Owner ruling
  2026-10-29: no identity pass, and nothing borrowed from the five identity-pass boards.
- **Coach does both jobs:**
  - **Free NutriCoach (empty chat):** keeps four "Try asking" prompts. One or two of them teach the app
    (e.g. "What's the fastest way to log a meal?", which the coach answers by pointing to the camera). One
    is a **Pro prompt**: marked with a small "Pro" badge, something only Coach Pro can do (e.g. asking about
    your actual week). Tapping it explains what Coach Pro would do with that question and offers the
    upgrade. The owner confirmed this is not too pushy.
  - **Coach Pro (chips above the chat):** keeps today's personal chips, plus **at most one** feature chip
    for a feature the person hasn't used yet (e.g. "Help me import a recipe" for someone who has never
    imported). It stops appearing once they have.

## The moments (owner confirmed this list)

**Tooltips** — point at a control once, the first time the person is on that screen:

| #   | Screen                             | Points at                                              | Text                                      |
| --- | ---------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| T1  | Home                               | the + / Scan button                                    | "Scan a barcode, label, receipt or menu." |
| T2  | Quick Log (screen and Home drawer) | the camera button, shown once they start typing a food | "Snap it instead."                        |
| T3  | Pantry                             | receipt scanning, next to "add item"                   | "Add a whole shop from the receipt."      |
| T4  | Meal plan add-recipe sheet         | the Import row                                         | "Paste a link or snap a cookbook page."   |

**Toasts** — after the slow way, with a button (the existing toast supports one action button):

| #   | Trigger                                                          | Text                                        | Button                               |
| --- | ---------------------------------------------------------------- | ------------------------------------------- | ------------------------------------ |
| S1  | The person's **third** food logged by typing                     | "Logging is faster with the camera"         | **Try it** → opens the camera (Scan) |
| S2  | The person **saves a recipe they built by hand** (recipe wizard) | "Next time, import it from a link or photo" | **Import** → opens import            |

A tip is skipped for good if the person has already used that feature (e.g. T1 and S1 never show to
someone who has scanned; T4 and S2 never show to someone who has imported).

## Free and Pro users (owner decision, 2026-10-30)

The free plan does not include receipt scanning, menu scanning, recipe import by link or photo, or voice,
and allows 3 scans a day (`shared/types/premium.ts`). **Free users only get tips for what they can use
today; a tip is never an upgrade ad.** So:

- **T1** for free users names only what they have: "Scan a barcode or nutrition label." Pro users get the
  full text.
- **T3** (receipt scanning) shows to Pro users only; free users don't have the button.
- **T4** and **S2** (import) show only to people whose plan includes the import they point at.
- **S1** opens the camera, so it is skipped when the person has no scans left today (my call).

The only upgrade path in this work is the Coach's one Pro prompt, which the owner approved.

## Coach teaching prompts are fixed answers (owner decision, 2026-10-30)

When a free user taps an app-teaching prompt in NutriCoach, **a short written answer appears instantly,
with a button that opens the feature** (e.g. the camera). It is not sent to the AI and does **not** use one
of the 3 daily coach messages. The coach's server prompt is unchanged. (The Pro prompt still explains what
Coach Pro would do and offers the upgrade, and also doesn't use a message — my call, same reasoning.)

## Calls made while writing this (check these)

- **S1 counts foods typed into Quick Log** (screen and Home drawer) only, using a new counter kept on the
  phone, starting from zero (typed and spoken logs are stored the same way on the server, so past history
  can't be counted). Voice logs don't count toward it.
- **"Already used" needs new tracking.** Today's Home usage counts only go up when an action is tapped on
  Home; scanning from the + button, Pantry receipt scanning and import from the meal plan sheet aren't
  recorded. The builder adds those tracking points.

## Goals, non-goals, anti-goals

- **Goals:** a new user meets each camera / import feature at the moment it would save them typing; the
  Home screen gets calmer (no Discover); free users see what Coach Pro adds.
- **Non-goals:** adding voice to screens that lack it (separate todo); redesigning screens; onboarding
  changes; a "tips" settings page; deeper personalization.
- **Anti-goals (a failure even if it works):** tips that repeat after being seen or after the feature was
  used; more than one tip on screen at once; a tip covering the thing it points at or the keyboard's text
  field; anything that reads as an ad (gradients, emoji, ✨, "TRY THIS" labels) — that is what Discover
  was removed for.

## What exists to build on (from a 2026-10-29 code sweep)

- **No tooltip / coach-mark component exists** — this is new. The camera's own `CoachHint`
  (`client/camera/components/CoachHint.tsx`) is a fading overlay with no memory; reference only.
- **Toasts:** `useToast()` (`client/context/ToastContext.tsx`) with `{ success, error, info }(message,
{ action?: { label, onPress } })`; one toast at a time, a new one replaces the current one.
- **"Show once" memory:** Discover keeps dismissed ids in AsyncStorage (`client/lib/discovery-storage.ts`)
  and hides a card once its feature was used, via per-user Home action usage counts
  (`client/lib/home-actions-storage.ts`, `getActionUsageCounts`).
- **Coach:** free NutriCoach's prompts are hard-coded `SUGGESTED_PROMPTS` in
  `client/screens/ChatScreen.tsx`; Coach Pro's chips come from the server
  (`server/services/coach-context-builder.ts`, at most 5). Coach Pro is gated by
  `usePremiumFeature("coachPro")`; Home already shows `UpgradeModal` for premium actions.

## Left to the builder

- The tooltip component's look and motion, within the current theme and the project's accessibility rules
  (screen readers must hear the tip and be able to close it; respect reduced motion).
- Where "seen" and "used" are stored and whether they follow the account or the device — reuse the
  existing usage counts where they fit.
- How "one tip per screen visit" is enforced, and how T2 detects "started typing".
- Exact wording of the two app-teaching Coach prompts and the Pro prompt, and what the Pro prompt's
  explanation says before the upgrade.
- Whether Coach Pro's feature chip is chosen on the server (with the other chips) or added on the client —
  this follows from where "used" is stored (on the phone means the client adds it).
- Removing the Discover code, its storage key and its tests cleanly, and moving For You up.
