---
title: "VoiceOver cannot start a scan — the scan-menu item and the camera capture button both fail to activate on double-tap"
status: backlog
priority: high
created: 2026-08-07
updated: 2026-08-07
assignee:
labels: [accessibility, camera, navigation, ios]
github_issue:
human_led: true
blocked_reason: "VERIFICATION is device-gated; DIAGNOSIS is not. Whether the capture control and the menu items carry an `accessibilityRole` and an activation handler is readable in source today, and the investigation should start there rather than waiting for hardware. What needs a physical device with a screen reader is confirming the fix actually works: VoiceOver does not run on the iOS Simulator, `adb input` does not drive TalkBack, and jsdom drops accessibility attributes entirely — an activation failure is native gesture-recognition behaviour with no test surface."
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

## Investigation pointers — behaviour observed, cause NOT yet diagnosed

Nothing below is confirmed; it is where to look first.

- The likely shape for both is a custom `Pressable`/gesture handler that responds to raw touch
  events rather than to the **accessibility activation** VoiceOver's double-tap dispatches. A
  control that handles `onPressIn`/pan gestures but never receives an accessibility action looks
  inert to a screen reader while working perfectly by touch.
- Check `accessibilityRole` and `onAccessibilityTap` on the capture control and the scan-menu
  entries. A view with no button role may not receive the activation at all.
- The menu **dismissing** on double-tap suggests the activation is landing on a backdrop/dismiss
  responder rather than the item — worth checking whether the menu's overlay sits above its items
  in the accessibility tree, or whether the items are outside an `accessibilityViewIsModal` scope
  that the backdrop owns. Note `client/camera/components/ProductChip.tsx:232` and
  `client/screens/MenuScanResultScreen.tsx:334-370` already set `accessibilityViewIsModal` in
  camera-adjacent surfaces.

## Verification requirements

- **Physical iOS device with VoiceOver.** Simulator cannot run VoiceOver; its accessibility tree
  is a structural proxy only and cannot observe an activation failure.
- **Android/TalkBack must be checked separately and also needs hardware** — `adb input` does not
  drive TalkBack (proven: 22 consecutive swipes left the focus rectangle immobile), so the same
  defect on Android cannot be confirmed or refuted by the emulator. No physical Android device is
  currently available.
- A passing unit test is not evidence here. jsdom drops accessibility attributes entirely, so a
  test asserting the button renders with a label says nothing about whether it activates.

## Related

- PR #754 — macro-tile label/value split into two screen-reader stops (same "found during 2c's
  device pass, pre-existing on `main`" disposition).
- `todos/P1-2026-08-04-duplicate-ios-announcers-in-usenutritionlookup.md` — the other device-gated
  accessibility todo from this slice.
