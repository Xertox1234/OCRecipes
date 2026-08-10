---
title: "VoiceOver cannot start a scan — the scan-menu item and the camera capture button both fail to activate on double-tap"
status: backlog
priority: high
created: 2026-08-07
updated: 2026-08-09
assignee:
labels: [accessibility, camera, navigation, ios]
github_issue:
human_led: true
blocked_reason: "VERIFICATION is device-gated; diagnosis is DONE (2026-08-09, see Source-level diagnosis section). What needs a physical device with a screen reader is confirming the diagnosis discriminators and the eventual fix: VoiceOver does not run on the iOS Simulator, `adb input` does not drive TalkBack, and jsdom drops accessibility attributes entirely — activation delivery is native gesture-recognition behaviour with no test surface."
---

# VoiceOver cannot start a scan

> **Priority note:** `high` reflects the **merge gate**, not the blast radius — the fix is
> device-verifiable only, so this todo must never arm auto-merge
> (`scripts/todo-automerge-guard.sh` keys on priority). The actual severity is **higher than
> `high` conveys**: see below.

## Severity — this is not a polish issue

With VoiceOver running, a user **cannot start a scan at all**. Scanning is the app's primary
function; camera/OCR capture is the product's stated focus. Every downstream surface that a scan
feeds — the nutrition detail screen, the verified-product pipeline, Add to Today — is unreachable
for a screen-reader user, however accessible those screens themselves are.

Both defects were found while running slice 2c's device pass, which had been carefully checking
accessibility on a screen that a VoiceOver user cannot navigate to in the first place.

## The two defects

Observed 2026-08-07 on a physical iPhone 16 Pro Max (iOS 18.7.8) with VoiceOver enabled, running a
development-profile build against a local backend.

1. **Scan-menu item does not activate.** Double-tapping the "scan barcode" entry in the scan menu
   **dismisses the menu** instead of navigating into the camera. Reported as "it just closes the
   screen."
2. **Camera capture button does not activate.** Once in the camera (reached by deep link, see
   below), the capture button "does not activate when touched like other elements" — double-tap
   produces no capture.

Each alone blocks the flow; together they close both the menu route and the direct route.

## Not a slice 2c regression — do NOT fix this on that branch

`feat/nutrition-detail-2c`'s diff (`fb1baf71..HEAD`) touches only
`client/components/nutrition/*`, `client/components/badge-severity-visuals.ts`,
`client/screens/NutritionDetailScreen.tsx`, `client/hooks/useNutritionLookup.ts`, tests and docs.
No camera file, no scan menu. These defects are pre-existing on `main`.

Same disposition as the macro-tile finding that became PR #754: branch off `main`, never off a
feature branch whose reviewed head would be invalidated by an unrelated commit.

## Reproduction

1. Physical iOS device, VoiceOver ON (it does **not** run on the Simulator).
2. From Home, open the scan menu ("Open scan menu"), swipe to the barcode-scan entry, double-tap.
   → the menu dismisses; the camera never opens.
3. Bypass the menu with `ocrecipes://scan` (route registered at `client/navigation/linking.ts:43`).
4. In the camera, swipe to the capture button and double-tap. → no capture.

## Source-level diagnosis (2026-08-09) — code-confirmed; device discriminators below

The original "custom gesture handler" guess is wrong: both controls are plain `Pressable`s with
correct `accessibilityRole="button"` and labels. The defects are structural.

### Defect 1 (scan-menu item) — the backdrop button is what activates

- If the item's `onPress` had run, the menu would close AND navigate: `ScanFAB.tsx:91-95` calls
  `closeMenu()` then `navigateAction(...)`, and `navigateAction("scan-barcode")` is an
  unconditional `navigation.navigate("Scan")` (`client/components/home/action-config.ts:20-21`)
  with no VoiceOver-dependent branch. "Closes without navigating" therefore means the item
  handler never ran — the only handler producing bare dismissal is the backdrop's `onClose`
  (`client/components/SpeedDial.tsx:63-68`).
- **Structural defect A — full-screen accessible dismissal button.** The backdrop is an
  `absoluteFillObject` `Pressable` labeled "Close speed dial", UNDER the items, overlapping
  every item's frame, and FIRST in VoiceOver's frame-sorted focus order. It is also the likely
  auto-focus landing: opening the menu removes the focused FAB from the a11y tree (the wrapper's
  `accessibilityViewIsModal`, `SpeedDial.tsx:39`) with no focus management, so VoiceOver
  re-anchors to the first modal element — the backdrop.
- **Structural defect B — same-named decoy element per action.** Each action renders TWO
  focusable elements announcing the same name: the label pill's `Text` (`SpeedDial.tsx:97-103`,
  focusable by default, no handler — activating it does nothing) and the 44×44 mini-FAB
  (`SpeedDial.tsx:105-124`, the only real target). The pill is the visually prominent element; a
  user who stops on the first "Scan Barcode" announcement double-taps a decoy.
- **Structural defect C — synthesized-tap-only activation.** No `onAccessibilityTap`, no merged
  larger target: activation relies wholly on UIKit's fallback tap at the accessibility frame's
  midpoint, fragile against any frame drift (the rows mount under a Reanimated
  `FadeInUp.springify()` entering animation) and unnecessary when a direct handler exists.
- Scoping is NOT the bug: ScanFAB and the SpeedDial mount as siblings of the whole
  `Tab.Navigator` (`client/navigation/MainTabNavigator.tsx:204`), so `accessibilityViewIsModal`
  correctly suppresses the tab bar and screen content.

### Defect 2 (capture button) — silent phase gate, not an activation failure

- `onShutterPress` silently drops the press when the phase doesn't capture:
  `client/screens/ScanScreen.tsx:465-468` — `if (!getCapturePlan(phase).capture) return;`.
- Phase map (`client/screens/scan-screen-utils.ts:330-356`): dead in `IDLE`,
  `BARCODE_TRACKING`, and all reviewing/classifying phases; armed in `HUNTING`,
  `BARCODE_LOCKED`, `LABEL_PROMPTED`, `STEP2_CONFIRMED`.
- `CAMERA_READY` fires on screen focus (`ScanScreen.tsx:165-169`) → `HUNTING`. Holding a
  product with the barcode in frame → `BARCODE_TRACKING` → **shutter dead by design**
  (auto-scan phase). That is the natural posture when testing the barcode flow.
- The armed state is mirrored **only visually** — `shutterArmed` drives a yellow border/glow
  (`ScanScreen.tsx:721`, styles at 1095-1110). The `Pressable` (720-725) never sets
  `accessibilityState.disabled`, has no hint, and its label is always "Take photo". A VoiceOver
  user in a dead phase hears an active-sounding button and gets silence on activation —
  indistinguishable from a broken control.
- Historical echo: `getCapturePlan`'s docstring records the sighted twin of this bug (the
  `LABEL_PROMPTED` dead-end). The accessibility tree is the one remaining consumer that still
  doesn't read the shared gate.
- Residual uncertainty: in `HUNTING` with no barcode in frame, the shutter SHOULD capture
  (smart route → `takePicture`). If the device pass shows double-tap failing there too, an
  additional native activation failure exists — discriminator T4.

### Fix shape (post-confirmation)

- **SpeedDial:** hide the backdrop from the a11y tree (`accessibilityElementsHidden` +
  `importantForAccessibility="no-hide-descendants"`; sighted tap-to-dismiss keeps working) and
  add `onAccessibilityEscape={onClose}` on the wrapper (two-finger scrub = the canonical modal
  escape). Merge pill + button into ONE accessible element per action (row-level `Pressable`, or
  `accessible={false}` on the pill). Optionally `onAccessibilityTap={action.onPress}` and
  focus the first item on open (`AccessibilityInfo.setAccessibilityFocus`). In-codebase
  precedent for correct camera-adjacent modal scoping to model on:
  `client/camera/components/ProductChip.tsx:232`,
  `client/screens/MenuScanResultScreen.tsx:334-370`.
- **Shutter:** derive `accessibilityState={{ disabled: !shutterArmed }}` from the SAME
  `shutterArmed` the visual reads (the file's own source-of-truth discipline); replace the
  silent `return` at `ScanScreen.tsx:468` with an `announceForAccessibility` explaining the
  auto-scan ("Scanning automatically — no photo needed"); phase-aware `accessibilityHint`.
- Prop-level contracts (state mirror, hidden backdrop, one element per action) ARE unit-testable
  in the RN render harness; only activation delivery is device-only.

## Verification requirements

- **Physical iOS device with VoiceOver.** Simulator cannot run VoiceOver; its accessibility tree
  is a structural proxy only and cannot observe an activation failure.
- **Android/TalkBack must be checked separately and also needs hardware** — `adb input` does not
  drive TalkBack (proven: 22 consecutive swipes left the focus rectangle immobile), so the same
  defect on Android cannot be confirmed or refuted by the emulator. No physical Android device is
  currently available.
- A passing unit test is not evidence here. jsdom drops accessibility attributes entirely, so a
  test asserting the button renders with a label says nothing about whether it activates.

### Device-pass discriminators (VoiceOver, physical iPhone)

- **T1** Open the scan menu → note what announces FIRST. Expect "Close speed dial" — confirms
  auto-focus lands on the backdrop (defect A).
- **T2** Swipe to "Scan Barcode" **without** the button trait, double-tap → expect nothing
  happens — confirms the decoy text element (defect B).
- **T3** Swipe to "Scan Barcode, **button**", double-tap → if it navigates, defects A+B fully
  explain the report. If it dismisses or no-ops, an additional native failure exists — retest
  with Reduce Motion ON to implicate/clear the Reanimated entering animation (defect C).
- **T4** Camera at a blank wall (`HUNTING`), double-tap "Take photo" → expect a real capture
  (haptic + flash + chip). Failure here = genuine activation failure beyond the phase gate.
- **T5** Barcode in frame (`BARCODE_TRACKING`), double-tap → expect silence today — confirms
  the silent dead phase.
- **T6** Enter via "Scan Nutrition Label" (label mode), double-tap → expect capture →
  `LabelAnalysis`.

## Related

- PR #754 — macro-tile label/value split into two screen-reader stops (same "found during 2c's
  device pass, pre-existing on `main`" disposition).
- `todos/P1-2026-08-04-duplicate-ios-announcers-in-usenutritionlookup.md` — the other device-gated
  accessibility todo from this slice.
