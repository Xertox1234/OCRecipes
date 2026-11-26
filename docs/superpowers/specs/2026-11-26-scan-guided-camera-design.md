# Guided scan camera — design

Date: 2026-11-26 · Status: draft for owner approval · Mockups: `2026-11-26-scan-guided-camera-mockups/` (open the `.html` files in a browser)

## Why

The owner's verdict on today's scan camera: "it looks terrible, the user receives little guidance, then the camera just auto snaps the barcode without telling the user what just happened... it is very confusing."

The goal is a camera that teaches before it asks, shows where you are in a multi-step flow, and never moves on without saying what it caught. The owner supplied reference screenshots from another nutrition app (mode tabs, step-shaped frames, "Got it" example cards, a tips carousel). We use those **patterns** in OCRecipes' own look (terracotta accent, warm dark, Poppins), not the reference app's look. That is consistent with the 2026-10-29 ruling: keep the current design and restyle within `theme.ts`.

## Goals

- Every camera flow opened from the Home **+** menu gets the same guided treatment:
  - an **example card** before each step: a picture of what to scan, a title, one line on why, and "Got it";
  - a **frame shaped for the thing** being scanned;
  - a **one-line hint** under the frame;
  - a **clear capture moment**: green frame, a haptic buzz, and words naming what was caught.
- Multi-step flows show progress with **big step tabs** above the shutter.
- **No silent auto-advance.**
  - A detected barcode pauses the camera and shows a "Barcode found" card. Nothing moves on until the user taps.
  - A photo step says what it captured, with Retake, before moving on by itself about 1.5 s later.
- Help is always reachable through **"?"**.

## Non-goals

- No change to what each flow does after capture: the same result and review screens, server calls, nutrition lookup and logging. The log action stays on the screen after the camera. The only new capture paths are typing a barcode and the photo library. Both feed the existing paths.
- No redesign of result screens (LabelAnalysis, ReceiptReview, MenuScanResult, PhotoAnalysis, BatchSummary, NutritionDetail).
- No changes to the Home "Recently uploaded" / history list. The owner's ninth screenshot was reference only.
- No mode switching on the camera. The **+** menu chooses the flow, and the tabs show steps, not modes.
- No native or build changes: this ships as an OTA. Expo CNG means never touching `ios/` or `android/`.

## Anti-goals (a failure even if it works)

- The camera acts on a barcode without telling the user.
- Six flows that look alike today and drift apart again. That is why the shared shell exists.
- Example cards that nag regulars on every scan.
- Losing work: a tap on a tab or "Not this" must never throw away earlier photos (see the 2026-11-22 Retake ruling: retake keeps the barcode and earlier photos).

## Constraints

- Camera chrome stays dark over the feed and uses `CameraColors`. Accent fills use the `accentSolid` terracotta (#B5451C) and done/found states use herb green. Contrast rules: `docs/solutions/logic-errors/status-tone-used-as-both-text-and-fill-fails-contrast-2026-11-21.md`.
- Accessibility is carried over, not reset. Today's camera has careful VoiceOver/TalkBack work: announcements per step, `shutterArmed` mirrored into `accessibilityState`, overlay focus traps (`getScanOverlayA11y`) and reduced motion. Each new piece must keep those, and touch targets stay ≥ 44pt (the #1100 regression).
- The scan logic (the `scanPhase` reducer, retake ownership of temp files, the React Compiler constraints noted in `ScanScreen.tsx`) is kept. The shell is driven _by_ the phase. It does not replace it.
- Premium gates stay: Menu is gated on `menuScanner`, and receipts on `receiptScanner`.
- The simulator has no camera. Camera views need a device check on the owner's phone, but cards, tabs and sheets can be checked in the sim.

## Approaches considered

1. **Shared camera shell — chosen by the owner.** One reusable shell renders everything the flows share: the top bar (✕ / ?), the shaped frame, the hint line, the step tabs, the controls row, the example card, the help sheet and the one-time tips carousel. Each flow passes a small description of its steps (frame shape, example, wording, whether a shutter shows). The existing screens keep their logic and render inside the shell.
   - Gain: one look and one place to fix things.
   - Cost: more work before the first screen changes.
2. **Restyle each screen in place.** Faster to a first visible change, but it repeats the same parts six times, and they would drift apart again.
3. **One navigation screen per step.** Rejected: the camera would restart between steps and break the wizard's retake and temp-file handling.

## What the owner decided

### Entry and routing

The **+** menu picks the flow. Two routes change so each flow has its own camera:

| + action             | Today                    | New                                                  |
| -------------------- | ------------------------ | ---------------------------------------------------- |
| Scan Barcode         | `Scan` (smart camera)    | `Scan`, as the guided 3-step barcode flow            |
| Scan Nutrition Label | `Scan {mode:"label"}`    | unchanged route, guided 1-step                       |
| Photo Food Log       | `Scan` (same as barcode) | `Scan {intent:"log"}`: plate frame, example, shutter |
| Scan Menu            | `PhotoIntent` picker     | `Scan {intent:"menu"}` directly (premium gate kept)  |
| Scan Receipt         | `ReceiptCapture`         | unchanged route, guided parts flow                   |
| Batch Scan           | `BatchScan`              | unchanged route, guided batch flow                   |

| _(new)_ Photo: more options | — | `PhotoIntent` picker, unchanged |

`Scan` and its `intent` param already exist (PhotoIntent passes them). The builder confirms the direct Menu route keeps the same premium check `isIntentOptionLocked` applies.

**The PhotoIntent picker keeps a way in** (owner, 2026-11-26). It is reachable today only through + → Scan Menu, so the + menu gets one new item that opens it as it is. "Find recipes", "Just identify", "Quick calorie check" and "Cook & Track" stay reachable. The builder picks the item's label and icon.

**Generic camera entry points open Photo Food Log** (owner, 2026-11-26). These are the buttons that open plain `Scan` meaning "take a photo": QuickLog's camera button (`QuickLogScreen.tsx`), the Coach chat camera (`ChatScreen.tsx`), the camera teaching toast's "Try it" (`useCameraTeachingToast.ts`), History (`useHistoryData.ts`) and the scan FAB. They move to `Scan {intent:"log"}`. Plain `Scan` with no params becomes the barcode flow.

- **The auto-sorting "smart" photo path is retired.** That is the shutter in HUNTING, then `SMART_PHOTO_INITIATED`, then `CLASSIFYING`, then the `SMART_CONFIRMED` card. Under the "unused ≠ removable" ruling, its code is **recorded as unused, not deleted**: a todo names the phases and files.
- **Callers that pass params keep their behavior inside the new shell:**
  - `mode:"label"` and `mode:"front-label"`, and `verifyBarcode` from NutritionDetail and LabelAnalysis;
  - `intent` from PhotoIntent and CoachChat;
  - `returnAfterLog` from QuickLogDrawer. My call: it stays barcode → found card → log right away, as today, with no Nutrition or Front steps. The tabs show only Barcode.

### Barcode flow (mockup: `step-tabs-v2.html`)

Steps: **Barcode → Nutrition → Front (optional)**, then the existing next screen, where the user logs.

- **Step tabs** sit above the shutter, three big tabs with icon and label, in the spirit of the reference screenshot. Current step: terracotta fill. Finished: green with a ✓. Upcoming: muted. Front carries a small "optional" label.
- **Tapping a ✓ tab redoes that step** and keeps all other work. Upcoming tabs can't be tapped. (Owner accepted this proposal.)
- **Step 1, Barcode:** wide frame, no shutter (the hint says "It scans by itself"), torch, and a keypad button for typing the number.
  - On detection, the camera pauses, the frame turns green, the phone buzzes, and a card shows "Barcode found ✓", the product name and brand, and **[Not this]** / **[Next: nutrition →]**.
  - "Not this" resumes scanning.
- **Step 1, typing the number** (owner: build it in this work). The keypad button opens a number field. On submit it runs the same barcode lookup and shows the same "Barcode found" card, so a typed number and a scanned one behave the same from there.
- **Step 2, Nutrition:** tall frame, a shutter, and **Skip**.
- **Step 3, Front:** square-ish frame, a shutter, and **Skip**. A photo or Skip goes to the next screen. **There is no "Skip & log"**: logging happens on the next screen.
- **After each photo** (owner: show, then move on), the frame turns green and a short card says "Label captured ✓" / "Front captured ✓" with **Retake**. It moves on by itself after about 1.5 s (today it waits 1 s). With a screen reader on, it waits for a tap, as `useAutoAdvanceTimer` does today. The same applies after the shutter in the single-step flows, before going to their result screen.
- **Skipping Nutrition but photographing the Front** must work. Today `STEP3_REVIEWING` requires a nutrition photo, so the reducer grows this case.
- **Redoing the Barcode step** (my call, from the builder check): scanning the same barcode again keeps the photos. A different barcode clears the Nutrition and Front photos, with a one-line notice ("New product: earlier photos cleared"), so photos of product A are never logged against product B. The reducer grows the needed "jump back" transitions. "The scan logic is kept" means it is extended, not rewritten.
- **The found card keeps today's safety signals** (my call): the top allergen or nutrition flag (`ScanFlagBadge`), and the warning haptic for a severe allergen.

### Single-step flows (mockup: `other-flows.html`)

These have no tabs. A small title pill at the top names the flow.

- **Nutrition Label:** tall frame. The example card is a Nutrition Facts panel ("Get the exact numbers from any label…"). Shutter and gallery.
- **Photo Food Log:** big, near-square frame. The example card is a plate ("whole plate, from a little above, good light"). Shutter and gallery.
- **Menu:** tall, page-shaped frame. The example card is a menu page ("one page at a time"). Shutter and gallery.

**Photo library button** on Label, Photo Food Log and Menu (owner: build it in this work). It uses the already-installed `expo-image-picker`, the way ReceiptCapture does. A library photo goes through the same path as a camera photo: the same scan quota (`remainingScans`), premium gate and temp-file ownership.

### Receipt flow

The tabs become **Part 1 · Part 2 · Part 3** (marked "if needed"), matching today's limit of 3 photos (`MAX_PHOTOS = 3`). The frame is very tall and narrow. **Done** is available once Part 1 is taken. From Part 2 on, the hint says "overlap the last line a little". Gallery import stays.

### Batch flow

There are no tabs. Each scan flashes the frame green, buzzes, and shows a toast "✓ Added: <name>". A running list above the controls shows the item count and the last items with ×quantity, plus "See all". The button reads **Done · N**. A repeat scan adds to the item's count, as today.

### Example cards

- Each step of each flow has one. The card covers the dimmed camera, the step tabs stay visible, and the controls are muted.
- **They show for the first 3 scans of that flow, then only through "?"**. (Owner accepted this proposal.)
- Example art is drawn for OCRecipes, not taken from the reference app: a barcode in a frame, a Nutrition Facts panel, a package front, a plate, a menu page, a receipt, and a barcode with a ×3 badge.

### Help: "?" sheet (mockup: `tips.html`, option B)

A bottom sheet with:

- the current step's title and one-line help;
- **"Show the example again →"**;
- **"Tips for every scan"**: hold still, use plenty of light or tap ⚡, fill the frame, and "Barcode won't read? Type the number" (barcode steps only).

### One-time tips carousel (mockup: `tips.html`, option A)

It is shown **once ever, before the user's very first scan of any flow**, ahead of that flow's first example card. It is a light (app-theme) screen with a hero image, "Get the best scan" with 3 tips, page dots, and Next / Scan now. The owner chose **both** the carousel and the tips in "?".

## Design and UI skills: required in the build

The owner asked that the build use the design and UI skills available. Each PR in the plan names the skill it follows.

| Skill                                                                                            | Used for                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crafting-ui` (project)                                                                          | This section's tables (parts 2–4). Its "look at it, then stop" pass (sim recording → `frames.mjs video` → `references/critique.md`, at most 2 rounds) runs before each PR is called done. |
| `interaction-feel` (project)                                                                     | Press states on tabs, buttons, the shutter and cards; haptics; the "Got it" / Next / Skip feedback.                                                                                       |
| `expo:expo-animation`                                                                            | Frame-shape morphs, the found moment, card and sheet entrances, reduced-motion variants, using Reanimated, Gesture Handler and `expo-haptics`.                                            |
| `expo:expo-design-system`                                                                        | Any new token goes into `theme.ts` / `constants/animations.ts`, never hardcoded. Check for design-system drift.                                                                           |
| `ui-design:accessibility-compliance` and `ui-design:mobile-ios-design` / `mobile-android-design` | VoiceOver and TalkBack for the tabs (as a step list), cards and the sheet; 44pt targets; platform idiom for the bottom sheet.                                                             |
| `verify-ui` (project)                                                                            | A simulator check of each card, the tabs, the "?" sheet and the carousel. Live camera views need a device check: the sim has no camera.                                                   |
| `mobile-reviewer` (reviewer roster)                                                              | The review pass for each PR.                                                                                                                                                              |

### Direction: crafting-ui part 1, skipped on purpose

The existing OCRecipes system (warm parchment and dark, terracotta accent, herb green, Poppins) is the direction. Under the 2026-10-29 ruling (keep the current design, no identity pass, restyle within `theme.ts`), no new directions are drawn. Two things the camera shares with the reference app are kept on purpose: the dark camera chrome (the platform idiom over a live feed) and white corner brackets, the universal sign for "aim here". The rest is OCRecipes' own: terracotta for the current step, herb green for done/found, the warm `#2C2420` surfaces instead of neutral grey, Poppins, and in-house example art.

### Concept → everything people touch (part 2)

The concept is **"show me, then tell me what you saw."** The camera always shows an example first and always names what it caught.

- **Step tabs:** the current step is a terracotta fill, done is a green ✓ (the ✓ arrives via the existing `stepCheckSpringConfig`), and upcoming is muted. A ✓ tab can be pressed and dims on press.
- **Frame:** white at rest and green on capture. Its shape _is_ the instruction.
- **Hint line:** one sentence, which changes only when the step changes or after 5 s / 10 s with nothing caught. Today's `CoachHint` escalation is kept: "Try moving closer", then "Tap ⚡ for light", then "Type the number".
- **Shutter:** present only on steps that capture by tap. Absent, not greyed out, on auto steps.
- **Example card:** in-house art, a title, one "why" line and a white "Got it" pill. It is the first-run teaching surface.
- **Found card:** names the thing ("Barcode found ✓ · Oat Crunch Granola") with two plain actions.
- **Loading, while the product name is still fetching:** the card shows "Barcode found ✓" with a skeleton line where the name will go. It never says "Loading…".
- **Not in database:** the card says "We don't know this one yet. The label and front photos will fill it in" and offers **[Next: nutrition →]**.
- **Error and offline:** the card says what failed in one line and offers **[Try again]** / **[Type it in]**. It never sends the user back to the camera silently.
- **Batch "Added":** a toast plus the row appearing in the list, where the eye already is.

### Moments and their budget (part 3)

| Moment                           | How often (heaviest user)     | What it means     | Budget                                                                                                                                                                           |
| -------------------------------- | ----------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barcode found / photo taken      | a few times a session         | "I caught it"     | **Signature moment.** Short and settled: frame turns green and corners settle (`reticleSettleSpringConfig`), a success haptic, the card rises from the bottom edge. No confetti. |
| Step tab ✓                       | a few times a session         | progress          | The ✓ pops once (`stepCheckSpringConfig`, about 11% overshoot, as the existing pill does). No haptic: the found moment already buzzed.                                           |
| Batch "Added"                    | **many times a minute**       | "one more"        | In place only: green flash on the frame, a light `selection` haptic, the count ticks, and the new row shows in the list. No travel, no overshoot, no entrance motion.            |
| Frame shape change between steps | a few times a session         | "now aim at this" | Corners glide to the new shape in 300 ms, no bounce.                                                                                                                             |
| Example card / "?" sheet         | first 3 scans, then on demand | teaching          | The card fades in over the dimmed feed and the sheet slides up with a no-bounce spring.                                                                                          |
| Tips carousel                    | once ever                     | welcome           | The one rare moment: the hero image may ease in and the pages swipe with velocity. It is still calm.                                                                             |
| Hint escalation                  | rare per scan                 | "still stuck?"    | Text crossfade only.                                                                                                                                                             |

### Motion plan (part 4)

| Element                      | Trigger                        | What changes                                      | Spring / easing                                                                                                                                 | Moves first                          | Haptic                   | Reduced motion                |
| ---------------------------- | ------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------ | ----------------------------- |
| Frame corners                | barcode lock / capture         | colour → green, then scale settle                 | `reticleSettleSpringConfig`                                                                                                                     | colour (settles first)               | `notification(Success)`  | colour change only, no scale  |
| Found card                   | after the frame settles begins | slides up from the bottom, fades in               | `bannerEntrySpring` (damping ratio about 0.71, so about 4% overshoot) with `overshootClamping` on, or a near-critical spring from `springs.mjs` | card body, then buttons a beat later | — (frame already buzzed) | fade only                     |
| Frame shape                  | step change                    | corners animate to the new rect                   | `expandTimingConfig` (300 ms ease-out cubic)                                                                                                    | —                                    | —                        | instant jump to the new shape |
| Step tab                     | step done                      | fill → green, ✓ pops                              | `stepCheckSpringConfig`                                                                                                                         | fill colour                          | —                        | colour only, no pop           |
| Tab / button / shutter press | press                          | dim (tabs) or scale ≤ 0.96 (shutter, pills)       | `pressSpringConfig` (overshootClamping)                                                                                                         | —                                    | `selection` on tab redo  | dim instead of scale          |
| Example card                 | step start (first 3)           | feed dims, card fades in                          | `contentRevealTimingConfig`                                                                                                                     | dim, then card                       | —                        | fade only                     |
| "?" sheet                    | tap ?                          | slides up, interruptible by drag                  | no-bounce spring, carries release velocity                                                                                                      | sheet                                | `selection`              | fade, no travel               |
| Batch toast + row            | each add                       | toast fades in, row appears in place, count ticks | `toastSpringConfig` (no travel), `toastExitTimingConfig`                                                                                        | count                                | `selection`              | same, minus any travel        |
| Carousel pages               | swipe / Next                   | pages slide with gesture velocity                 | physics spring with `mass` written                                                                                                              | page                                 | —                        | crossfade                     |

Every animation can be interrupted. For example, tapping "Not this" mid-entrance reverses the card and resumes scanning, with no stacked animations. Reduced motion follows `AccessibilityInfo` change events live, which the project's `useAccessibility` hook already does. Any new spring values come from crafting-ui's `scripts/springs.mjs`, with `mass` written explicitly.

### States to build

The plan marks each of these as built or n/a with a reason:

- **Camera and permission:** idle, hunting, tracking, found, product name loading, not in database, lookup error, offline, permission denied (existing `CameraPermissionGate`), camera unavailable (existing).
- **Each capture step:** captured, retake, skipped.
- **Example card:** first-run (counts 1–3) and suppressed (count > 3).
- **Help:** "?" sheet open, carousel first-ever.
- **Receipt:** parts 1 / 2 / 3, at the 3-photo limit.
- **Batch:** empty list, duplicate (count increments), at `MAX_ITEMS`.
- **Gates:** premium-locked Menu and Receipt, and the daily scan limit (today's `remainingScans` pill, which is kept and restyled).
- **Display:** torch on, reduced motion, VoiceOver, TalkBack, small screen (iPhone SE size), large text up to `MAX_FONT_SCALE_CONSTRAINED`.

## Left to the builder

- **The shell's API and file layout.** Expected under `client/camera/`, next to `ScanReticle`, `StepPill`, `CoachHint` and `ProductChip`, which it largely replaces or absorbs. Deciding whether to delete or adapt those is the builder's call. Per the owner's "unused ≠ removable" rule, record anything left unused instead of deleting it silently.
- **How the reticle morphs between frame shapes** (animated or instant), within the reduced-motion rules.
- **Where the "seen N times" counters and the "carousel seen" flag are stored.** Use device-local storage, the same way the app already stores small per-user flags. No server work.
- **Exact copy wording** beyond what the mockups show. Keep it short, plain, and in the app's tone.
- **The art format for the example images** (SVG components vs bundled PNGs). Keep it in the theme palette.
- **The PR order.** The owner's staging: (1) the shell plus the barcode flow, (2) label, photo and menu with the routing changes, (3) receipt and batch. Tips and the carousel go in with (1) or as their own PR.
- **Auditing every `navigate("Scan")` caller** against the routing decisions above (settled by the owner), and flagging any that doesn't fit either "means take a photo" or "passes params".
- **How the "first 3 scans" counter counts** (per flow; whether a cancelled scan counts).
- **The not-in-database and error states of the found card** (wording in the concept section above).
