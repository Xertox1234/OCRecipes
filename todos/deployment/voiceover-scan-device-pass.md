# VoiceOver device pass — run sheet

Companion to `todos/P1-2026-08-07-scan-flow-unreachable-with-voiceover.md`.
Device: iPhone 16 Pro Max (paired, `36ADE538-B79C-54F7-AE8B-0212BEC75914`).

**Record what actually happened in the "Actual" line under each test.** Anything you can't
tell (announcement scrolled past, unsure which element had focus) → write "unclear", not a guess.

VoiceOver on: Settings → Accessibility → VoiceOver, or triple-click the side button if the
Accessibility Shortcut is set. Gestures: swipe right = next element, double-tap = activate,
two-finger scrub (Z shape) = escape/dismiss.

---

## PART A — no rebuild needed (T1–T3)

`client/components/SpeedDial.tsx` last changed **2026-06-22**, well before the 2026-08-07
report. The build on the phone is a **dev client**, so it loads JS from Metro — meaning it runs
today's `main` with no rebuild, and any fix I write reaches the phone by reloading.

**Setup (done 2026-08-17, both verified up):**

- Backend: `http://192.168.0.132:3000` → `/api/health` returns `{"status":"ok"}`
- Metro: `http://192.168.0.132:8081` (started with `--dev-client --host lan`)
- `EXPO_PUBLIC_DOMAIN` was stale (`192.168.0.103`) → corrected to `192.168.0.132` **before**
  Metro started, so the running bundle has the right backend address.

The phone previously showed "no development servers found" because Metro was down. It should
now list the dev server; if not, use "Enter URL manually" → `http://192.168.0.132:8081`.

### T1 — what gets focus when the menu opens

1. Home tab, VoiceOver on. Find and double-tap the scan FAB ("Open scan menu").
2. **Do not swipe.** Listen to what VoiceOver announces FIRST.

- Expect (hypothesis A): **"Close speed dial"** — auto-focus landed on the full-screen backdrop.
- **Actual (2026-08-17): "close speed dial button" — and SOMETIMES "close scan menu button".**

**Result: hypothesis A CONFIRMED, plus a new defect D the todo does not list.**

"Close scan menu" is not the backdrop — it is the FAB itself (`ScanFAB.tsx:110`,
`accessibilityLabel={menuOpen ? "Close scan menu" : "Open scan menu"}`).

The todo's diagnosis claims the FAB is _removed_ from the a11y tree when the menu opens, via
the SpeedDial wrapper's `accessibilityViewIsModal`. **That claim is empirically false** — the
user can focus it. The mechanism: `ScanFAB.tsx:103-122` renders `<SpeedDial>` FIRST and the FAB
SECOND, and the FAB carries `zIndex: 1000` vs the SpeedDial wrapper's `zIndex: 999`. On iOS,
`accessibilityViewIsModal` only suppresses siblings ordered BEFORE the modal view; later /
higher siblings stay accessible. So the FAB is never suppressed.

**Why this matters more than defect A:** focus lands on the FAB → double-tap → `handlePress()`
→ `menuOpen` is true → `closeMenu()` → **menu dismisses with no navigation.** That is the
reported symptom ("it just closes the screen") exactly, via a second independent path. Two
focusable elements (backdrop + FAB) now both produce bare dismissal, which also explains the
"sometimes" — whichever one VoiceOver happens to anchor on.

**Fix implication:** hiding the backdrop from the a11y tree is NOT sufficient on its own. The
FAB must also be suppressed while the menu is open (`accessibilityElementsHidden` +
`importantForAccessibility="no-hide-descendants"` on the FAB when `menuOpen`), or the ordering
inverted so the FAB precedes the SpeedDial.

### T2 — list the whole focus order (REVISED 2026-08-17 — original wording was unclear)

**Don't activate anything. Just listen and list.**

1. Open the scan menu.
2. Swipe **right** with one finger. Note what VoiceOver says.
3. Swipe right again. Note it. Repeat until you hear something you already heard (you've
   looped back to the start).
4. Write the list **in order**, word for word — including trailing words like "button" or
   "dimmed" if you hear them. Those trailing words are the whole point: a plain text label
   announces just `Scan Barcode`, while a real button announces `Scan Barcode, button`.

- **Actual (2026-08-17):** order is "very off". It tries to cycle the menu items, but
  **"close speed dial" is interleaved intermittently** among them rather than sitting in one
  fixed position. **The last item is consistently "close scan menu."**

**What this confirms:**

- Defect A (backdrop focusable) — CONFIRMED again, and worse than described: the backdrop is
  not merely first, it recurs _between_ items. Consistent with an `absoluteFillObject` frame
  (origin 0,0, full screen) being geometrically sorted against item frames that are still
  moving under the `FadeInUp.springify()` entering animation. Unstable frames → unstable order.
- Defect D (FAB focusable while menu open) — CONFIRMED: consistently LAST, which is exactly
  where a later/higher sibling sorts.

- Defect B (duplicate decoy pill) — **CONFIRMED** (user, follow-up 2026-08-17): _"it announces
  everything twice. Once for the text and once for the button."_ That is the label pill
  (`SpeedDial.tsx:97-103`, a focusable `Text` with no handler) and the mini-FAB
  (`SpeedDial.tsx:105-124`, the only real target) announcing the same name back to back.
  Half of every action's stops are dead.

All three menu defects (A, B, D) are now device-confirmed. Defect C (Reanimated frame drift)
remains inferred — it is the best explanation for the _instability_ of the order, but was not
isolated separately.

What this tells us: whether each action name appears **twice** (decoy pill + real button →
defect B), and where "Close speed dial" and "Close scan menu" sit in the order (defects A + D).

### T3 — the real target

1. Menu open. Swipe to **"Scan Barcode, button"** (with the button trait).
2. Double-tap.

- Expect: the camera opens. → defects A+B fully explain the original report.
- If it dismisses the menu or does nothing → an additional native activation failure exists.
  **Then retest T3 with Settings → Accessibility → Motion → Reduce Motion ON** (this implicates
  or clears the Reanimated entering animation, defect C).
- Actual: ****\*\*****\*\*****\*\*****\_\_****\*\*****\*\*****\*\*****
- Actual with Reduce Motion ON (only if needed): \***\*\*\*\*\***\_\_\_\***\*\*\*\*\***

---

## PART B — camera + backend (T4–T7)

Same setup as Part A (already up). Confirmed dev client, so the corrected backend IP is live
in the bundle.

Reach the camera by deep link if the menu is unusable: `ocrecipes://scan`

### T4 — shutter in a live phase (HUNTING)

1. Point the camera at a **blank wall** (no barcode in frame).
2. Swipe to "Take photo", double-tap.

- Expect: a real capture — haptic + flash + chip appears.
- Failure here = genuine activation failure beyond the phase gate (the shutter IS armed in
  `HUNTING`). This is the single most diagnostic test in Part B.
- **Actual (2026-08-17): PASSED.** Double-tap fired a real capture; the photo uploaded and
  analyzed, returning "No food detected" — correct for a blank wall. **No native activation
  failure exists anywhere in the flow.** The original defect-2 report is fully explained by
  the silent phase gate (now announced) plus the transient tracking phase (see T5).

**DEVICE PASS COMPLETE (2026-08-17).** T1/T2/T3/T4/T5 all resolved; T6 subsumed by T4 (same
capture path, no separate activation risk); T7's reachability question stands as the
pre-existing TalkBack-modality finding noted below, not a blocker for this fix.

### T5 — shutter in a dead phase (BARCODE_TRACKING)

1. Hold a product so its **barcode is in frame** but not yet locked.
2. Swipe to "Take photo", double-tap.

- Expect: silence / nothing. This is the known silent phase gate
  (`ScanScreen.tsx:465-468`) — by design today, but indistinguishable from a broken control.
- **Actual (2026-08-17): "it says product found and auto scans the barcode."** The scan
  auto-locked before a dead-phase double-tap was even possible, and VoiceOver announced
  "Product found, choose how to continue" — ProductChip's existing lock announcement
  (`ProductChip-utils.ts:198`), not this fix's copy.

**Reading: the scripted scenario is practically unreachable, and that is GOOD.**
`BARCODE_TRACKING` lasts only the few frames between first detection and lock — far shorter
than a VoiceOver swipe-and-double-tap. The dead-shutter silence the original report hit
almost certainly required holding an unscannable/failing barcode; with a readable one, the
auto-scan self-completes and self-announces. The blocked-reason announcement remains the
correct backstop for the reachable dead phases (an unreadable barcode holding TRACKING,
review phases), and its agreement with the gate is pinned by unit test either way. Not
re-testable on demand without a deliberately broken barcode — accept the unit-test coverage.

**End-to-end journey now verified under VoiceOver:** menu → "Scan Barcode, button" →
camera → auto-scan → "Product found, choose how to continue." That is the complete flow the
todo's severity section said was unreachable.

### T6 — label mode

1. Enter via "Scan Nutrition Label", frame a nutrition panel, double-tap "Take photo".

- Expect: capture → LabelAnalysis.
- Actual: ****\*\*****\*\*****\*\*****\_\_****\*\*****\*\*****\*\*****

### T7 — NEW: is the armed shutter even reachable? (BARCODE_LOCKED / STEP2_CONFIRMED)

Found 2026-08-17 by cross-referencing the phase maps; not in the original todo.
In `BARCODE_LOCKED` and `STEP2_CONFIRMED` the shutter is **armed** (yellow glow) but the
ProductChip sets `accessibilityViewIsModal` (`ProductChip.tsx:232`), which should trap
VoiceOver inside the chip.

1. Scan a barcode until it **locks** (chip appears, shutter shows the yellow armed border).
2. Swipe through **every** element. Can you reach "Take photo" at all?

- Question 1 — is "Take photo" reachable? ****\*\*****\*\*****\*\*****\_\_****\*\*****\*\*****\*\*****
- Question 2 — does the chip's own primary button carry the same action (i.e. is there a
  working screen-reader path forward without the shutter)? \***\*\*\*\*\***\_\_\***\*\*\*\*\***

If the shutter is unreachable BUT the chip's button works, this is by-design, not a defect —
note it and move on. If neither is reachable, the step-by-step barcode flow has no
screen-reader path at all.

---

## Post-fix retest — round 1 (2026-08-17)

Fix applied to `client/components/SpeedDial.tsx` on branch
`fix/voiceover-scan-menu-unreachable`; delivered over Metro (dev client, no rebuild).

**User-reported after reload:**

- "no longer [hear] close speed dial at all" → **defect A fixed**
- "announces the menu item only one time" → **defect B fixed**
- "stops at batch scan and does not advance to close scan menu button"

**"Stops at Batch Scan" is CORRECT, not a regression.** `Batch Scan` is the last of the six
`scanning` actions (`action-config.ts:113-119`). Focus halting there means
`accessibilityViewIsModal` is now _properly containing_ focus inside the menu — which it was
never doing before, because the full-screen backdrop in the a11y tree defeated it. So **defect
D was fixed as a side effect**: the FAB no longer leaks into the modal's focus order.

**But it removed the last swipe-reachable exit**, which is the risk flagged before the fix
went in. Exit paths after round 1:

- iOS: `onAccessibilityEscape` (two-finger scrub) — added in the same change, UNVERIFIED
- Android: **none** ← gap

**Round-2 change:** `BackHandler` (`hardwareBackPress` → `onClose`, Android-gated) added to
`SpeedDial`. No open/focus ref gating, unlike `useSheetBackHandler` — `ScanFAB` renders
`<SpeedDial>` only while `menuOpen`, so mount lifetime IS open lifetime.

## T3 — PASSED (2026-08-17)

Double-tapping "Scan Barcode, button" **opens the camera**. The originally reported defect 1
("it just closes the screen") is FIXED. Defects A, B and D fully explain the report; no
additional native activation failure exists, so **defect C never needed isolating**.

Bonus reported: the shutter is now VoiceOver-selectable on arrival, which it was not during the
earlier deep-link testing.

### Phantom regression — ProductChip "missing" (resolved, not a bug)

Reported alongside T3: "the preview UI that used to sit above the scan button is no longer
present." Triaged via `.claude/skills/regression-triage`:

- The change set was `SpeedDial.tsx` only — a component unmounted before `ScanScreen` renders.
- Every prop changed (`accessibilityElementsHidden`, `importantForAccessibility`,
  `onAccessibilityEscape`, `BackHandler`) is accessibility-only with **no visual effect**.
- Both entry paths (deep link `ocrecipes://scan` and the menu's `navigate("Scan")`) pass **no
  params**, so the changed navigation route was not the difference either.
- Dev client on live Metro ⇒ no OTA layer ⇒ not a stale bundle.

**Resolution: not a regression.** `ProductChip` is phase-gated
(`getProductChipVariant`) and renders nothing until a barcode LOCKS. The chip appeared as soon
as a barcode was actually scanned. Investigated and cleared: commit `71520d2e`, which rewrote
`getProductChipVariant`'s `default:` clause into explicit cases — every phase that previously
fell through to `default: return null` still returns null, so chip visibility did not change.

## Defect 2 (shutter) — fix applied 2026-08-17, AWAITING DEVICE TEST

- `getShutterBlockedReason(phase)` added to `client/screens/scan-screen-utils.ts` — exhaustive,
  no `default`, keyed on the same `ScanPhase` as `getCapturePlan`.
- `ScanScreen.onShutterPress`: the bare `return` on a dead phase now announces the reason
  (ungated across platforms — nothing else covers this drop).
- Shutter `Pressable`: `accessibilityState={{ disabled: !shutterArmed }}` (mirrors the yellow
  glow from the same source) + a phase-aware `accessibilityHint`. Deliberately NOT `disabled`
  — that would lag behind fast input and swallow the press before the announcement.

### Still outstanding

- ~~T4 / T5 / T7 (shutter)~~ — RESOLVED later this doc (T4 passed; T5's scripted scenario
  unreachable, unit + component coverage instead; T7 = the pre-existing containment findings).
- **Two-finger scrub dismissal — VERIFIED (user, 2026-08-17): "the z with 2 fingers closes
  the menu."** The sole non-selection iOS exit works on-device; both reviewers' Major is
  closed. Every iOS claim in this fix is now device-verified.

### Review round (2026-08-17, code-reviewer + mobile-reviewer) — all code findings fixed

- Both purpose-built SpeedDial regression tests were VACUOUS (mutation-proven: fix reverted,
  tests stayed green). Repaired: backdrop asserted by role COUNT (the backdrop no longer has
  a name to query), pill by testID + aria-hidden. Re-mutation-verified: all three
  tree-membership tests now go red without the fix.
- `check-accessibility.js` exemption failed open two ways (comment mention; conditional
  `={expr}` value) — hardened to comment-stripped, bare-or-`{true}`-only matching, plus
  quote-form-tolerant value match; 5 new tests in `scripts/__tests__/check-accessibility.test.ts`.
- The blocked-shutter announce had no coverage at its real call site — added component tests
  driving the actual shutter binding in `BARCODE_TRACKING` (announce fires, exact copy,
  aria-disabled mirrored, no capture) with an armed-press negative control.
- All 8 blocked phases' spoken copy pinned verbatim (swap-proof, not just non-empty).
- `SMART_ERROR` copy no longer presupposes spatial context ("from the card" → "find the
  retake button").
- Stale-hint tradeoff and the TalkBack-activation reasoning documented in code comments.

## Android — PERMANENTLY no device (stated 2026-08-17)

The user owns **Apple hardware only**. There is no physical Android device and there never will
be. The todo's `blocked_reason` ("No physical Android device is **currently** available") reads
as temporary; it is not. **Do not park any Android work on a device pass — that block never
clears.** Android still ships (see `feedback_cross_platform`); only its _verification_ changes.

Android SDK IS installed here — `~/Library/Android/sdk` (not on `PATH`), AVD `Medium_Phone`.
That covers more than it first appears:

| Android claim in this fix                              | How to verify                                                                                 | Status                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------- |
| Backdrop excluded from the a11y tree                   | Emulator + `uiautomator dump --compressed`, diffed pre/post                                   | AVAILABLE, not yet run       |
| Label pill excluded from the a11y tree                 | Same                                                                                          | AVAILABLE, not yet run       |
| Back key dismisses the menu (`BackHandler`)            | Emulator + `adb shell input keyevent KEYCODE_BACK` — a real key event, not a TalkBack gesture | AVAILABLE, not yet run       |
| Shutter announces its blocked reason                   | Unit test on `getShutterBlockedReason` (pure fn)                                              | AVAILABLE, not yet written   |
| TalkBack **focus order**                               | Nothing — `adb input` does not drive TalkBack, and there is no device                         | **PERMANENTLY UNVERIFIABLE** |
| TalkBack **activation** (double-tap fires the handler) | Same                                                                                          | **PERMANENTLY UNVERIFIABLE** |

Caution when running the dump: `focusable=false` is NOT evidence of exclusion — diff the
compressed dumps before and after, per `reference_talkback_emulator_verification`.

**The PR must state plainly which Android claims rest on code review alone** (the last two
rows), rather than implying a device pass is pending.

### Android emulator verification — RUN 2026-08-17, ALL PASSED

`Medium_Phone_API_36.1` (Android 16), debug APK built from this branch (`BUILD SUCCESSFUL`,
`expo run:android`). Menu opened via `adb shell input tap` — valid because TalkBack is OFF, so
this is ordinary input injection, not a TalkBack gesture.

`uiautomator dump --compressed` with the menu OPEN, counting `content-desc` occurrences:

- **"Close speed dial" — ABSENT.** The backdrop is out of the Android a11y tree.
- **Each of the six actions appears EXACTLY ONCE** (Scan Barcode, Scan Receipt, Scan Menu,
  Photo Food Log, Scan Nutrition Label, Batch Scan). The decoy pill is gone on Android too —
  this is the platform half that `accessible={false}` alone would have missed.
- **"Close scan menu" × 1** — the FAB remains as the labelled dismissal affordance.

Back key (`adb shell input keyevent KEYCODE_BACK`): menu closed (all six actions gone, FAB
label flipped back to "Open scan menu") **and the app stayed foreground** — proving the handler
returned `true` and consumed the press rather than letting it pop the screen underneath.

Note this counts occurrences rather than reading `focusable`, per
`reference_talkback_emulator_verification`: `focusable=false` is NOT evidence of exclusion.

### NEW FINDING (pre-existing, NOT introduced here, NOT fixed here)

The same dump shows the **background Home content is still in the Android a11y tree while the
menu is open** — "Search Recipes", "Quick Log", "Recipes section", and all four tab buttons all
remain present. `accessibilityViewIsModal` is iOS-only, and nothing mirrors it here, so the
scan menu is **not modal for TalkBack**: a TalkBack user can swipe out of the open menu into
the screen behind it.

Pre-existing on `main` and structurally out of scope for this todo: `SpeedDial` cannot fix it
from the inside, because the background is rendered by `MainTabNavigator` as a _sibling_. The
fix would have to lift "menu is open" up to the navigator and gate
`importantForAccessibility` there. In-codebase precedent for exactly this mirror:
`getScanOverlayA11y` in `client/screens/ScanScreenConfirmOverlay-utils.ts`, which mirrors
ScanScreen's iOS modal trap onto Android for the same reason.

## After the pass

Results get folded back into
`todos/P1-2026-08-07-scan-flow-unreachable-with-voiceover.md`, which then unblocks the fix
(`status: backlog`, `human_led: true`, device-gated by design).
