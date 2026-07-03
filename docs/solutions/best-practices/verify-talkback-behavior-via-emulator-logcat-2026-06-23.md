---
title: Verify TalkBack screen-reader behavior on an Android emulator by reading composed speech from logcat
track: knowledge
category: best-practices
module: client
tags: [accessibility, talkback, android, emulator, verification, logcat]
applies_to: [client/**/*.tsx]
created: '2026-06-23'
---

# Verify TalkBack screen-reader behavior on an Android emulator by reading composed speech from logcat

## When this applies

When an accessibility task hinges on "what does TalkBack actually announce?"
(does a live region over-announce, does a busy state speak, does a transition go
silent) and it was deferred as "physical-device-only / no automated path." It is
**not** device-only: TalkBack's composed spoken output is readable as text in
`logcat` once you raise its log level, so the check can be run from a tooling
session. Result is **provisional** (emulator TalkBack version may differ from a
real device) but strong and actionable.

## Examples

The procedure (proven 2026-06-23 resolving the smart-scan chip live-region todo):

1. **AVD + boot.** Use a `google_apis_playstore` (or `google_apis`) image — those
   ship TalkBack (Android Accessibility Suite). Boot with **hardware GPU**:
   `emulator -avd <AVD> -no-snapshot -gpu host -memory 4096 -cores 4`. The default
   `swiftshader_indirect` software GPU ANRs/wedges under a heavy RN app (repeated
   `com.android.systemui` ANRs are the tell).
2. **Enable TalkBack:**
   `adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService`
   then `adb shell settings put secure accessibility_enabled 1`. Disable for
   navigation with `adb shell settings delete secure enabled_accessibility_services`
   (an empty `put` is rejected).
3. **Raise verbosity** (default ERROR logs almost nothing): in the app, TalkBack
   Settings → Advanced → Developer settings → **Log output level → VERBOSE** (drive
   via `adb` taps + `uiautomator dump` for coords, with TalkBack temporarily OFF so
   single-taps register; the level is a persisted pref). ALSO
   `adb shell setprop log.tag.talkback VERBOSE`. The setprop does **not** survive a
   reboot — re-apply it and force-stop + restart TalkBack (it reads the level at
   process start) after any reboot. The in-app **Log output level** is a
   _persisted_ TalkBack pref, so a **reused** AVD that was set up in a prior
   session is already VERBOSE — the setprop alone then surfaces the full
   `ProcessorEventQueue`/`ttsOutput`/`action=SPEAK` lines without re-doing the UI
   step. Do **not** conclude "setprop alone is enough" from a reused AVD: a
   **fresh** AVD still needs the in-app level raised. (If the `talkback` tag logs
   nothing, the usual cause is TalkBack being momentarily disabled — e.g. an
   `accessibility_enabled 0/1` toggle — not a missing log level.)
4. **Read it:** `adb logcat -s talkback`. The
   `EventTypeWindowContentChangedFeedbackRule` line carries `ttsOutput= {…}` +
   `nodeLiveRegion=N`; `Pipeline … action=SPEAK text="…"` and
   `SpeechControllerImpl: Speaking fragment` are what it actually speaks. **Empty
   `ttsOutput= {}` = nothing announced.**
5. **Force the component state** with a throwaway harness. Two shapes:
   - **Parent-screen prop override:** override the component's prop directly in
     its parent screen (e.g. `<ProductChip phase={…fixture}>`) plus a dev toggle
     for the dynamic flag — NOT via initial reducer state (a mount-time action
     like `CAMERA_READY` resets it).
   - **Auto-advancing root-overlay harness (preferred for a multi-state sweep).**
     Mount the component-under-test as a **root overlay** (a sibling in
     `App.tsx`'s tree, under the existing providers) gated by a throwaway const,
     and drive it through an array of `{…fixture}` states with a `setInterval`
     auto-advance (~4.5s/step), `console.log`-ing a marker per step. This wins on
     two axes the prop-override doesn't: (a) it renders over the **cold-start
     Login screen**, so no auth / onboarding / camera-permission / navigation is
     needed to reach the screen; and (b) the timer drives every transition with
     **zero taps**, sidestepping the under-TalkBack double-tap activation problem
     entirely (see Exceptions). Correlate the `console.log` step markers
     (`ReactNativeJS` tag) with the `talkback` `action=SPEAK` lines by timestamp.
     Because the announce model lives inside the component, the overlay's props
     are behaviourally identical to what the real parent feeds it.
   Revert with `git restore` (delete the harness file + its mount).

## Exceptions

- `uiautomator dump` and `screencap` **hang** on a live-camera or
  continuously-animating screen (they wait for UI idle / pressure SurfaceFlinger),
  and concurrent `screencap`s + animation can **wedge** the emulator (→ device
  `offline`, hard-reboot). For an animating screen rely on logcat; reserve a single
  `screencap` for a static screen.
- Under TalkBack, `adb input tap` only **focuses** a control; activating it needs
  a double-tap — send `adb shell "input tap X Y; input tap X Y"` so both taps fall
  inside the ~300ms double-tap window. For a **state-driven** sweep, prefer the
  auto-advancing root-overlay harness (Examples §5) and avoid taps entirely —
  `announceForAccessibility` fires on programmatic state changes with no user
  interaction, so a `setInterval` drives the whole sweep.
- The result is provisional — confirm on a physical device before declaring a
  "verified-no-op" close.

## Related Files

- `client/camera/components/ProductChip.tsx` — the component whose live-region
  behavior was verified this way.

## See Also

- [Android container live region re-reads the whole subtree](../conventions/android-container-live-region-reannounces-whole-subtree-2026-06-23.md) — the gotcha this technique confirmed
- [Imperative announce must be content-keyed, not variant-keyed](../logic-errors/imperative-announce-must-be-content-keyed-not-variant-keyed-2026-06-24.md) — a same-discriminator content update this variant-stepped sweep structurally cannot catch (add an explicit placeholder→value case)
