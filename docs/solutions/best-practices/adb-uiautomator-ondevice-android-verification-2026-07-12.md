---
title: Drive and verify on-device Android UI behavior via adb + uiautomator (tap/back-press timing, not TalkBack)
track: knowledge
category: best-practices
module: client
tags: [android, emulator, adb, uiautomator, verification, backhandler, testing]
applies_to: [client/**/*.tsx, client/hooks/**/*.ts]
created: '2026-07-12'
---

# Drive and verify on-device Android UI behavior via adb + uiautomator (tap/back-press timing, not TalkBack)

## When this applies

When a task needs a real Android emulator to verify UI behavior that unit tests (Vitest/jsdom
`renderHook`) can't fully cover — timing-sensitive `BackHandler` races, navigation-focus
interactions, animation windows — and there's no scripted/Maestro coverage for it yet. This is
the general adb/uiautomator toolkit; for TalkBack screen-reader speech verification specifically,
see the companion solution linked below instead (different technique: logcat, not tap
coordinates).

## Examples

Procedure (proven 2026-07-12 verifying `useSheetBackHandler`'s close-animation and focus-scoping
fixes against `MealPlanHomeScreen`):

1. **Reuse the existing debug APK when possible — don't default to a full native rebuild.**
   `android/app/build/outputs/apk/debug/app-debug.apk` is a dev-client build that loads its JS
   from Metro at runtime, so a JS/TS-only change (no new RN-native dependency) doesn't need
   `npx expo run:android`'s full Gradle cycle. Verify first: `git log --since=<APK's mtime>
   -- package.json android/ ios/` and confirm no new native deps were added (a dev-only or
   server-only addition like `@sentry/node` doesn't count). If clean, `adb install -r
   android/app/build/outputs/apk/debug/app-debug.apk` + a running Metro (`npx expo start
   --dev-client`) is far faster than a rebuild.
2. **Boot:** `emulator -avd <AVD> -gpu host -no-snapshot`. `-no-snapshot` (not
   `-no-snapshot-load`) avoided an unexplained mid-session qemu exit that `-no-snapshot-load`
   alone did not prevent in this session — if the emulator process dies with a
   `Saving snapshot 'default_boot'` log line partway through a session, retry with
   `-no-snapshot` first before assuming a resource/sandbox problem.
3. **Networking — the emulator cannot reach the host's LAN IP.** `.env`'s `EXPO_PUBLIC_DOMAIN`
   is typically a LAN IP for iOS-simulator/physical-device parity, but the Android emulator's
   SLIRP networking only exposes `10.0.2.2` as the host-loopback alias (confirmed via `adb shell
   ping <LAN IP>` — 100% loss). Override at the process-env level when starting Metro —
   `EXPO_PUBLIC_DOMAIN="http://10.0.2.2:3000" npx expo start --dev-client` — rather than editing
   `.env` (which may be a symlink shared with the main checkout in a worktree session). Also
   `adb reverse tcp:8081 tcp:8081` (Metro) and `tcp:3000 tcp:3000` (backend) so the dev-client's
   own `localhost` fallback paths work too. `EXPO_PUBLIC_*` vars already set in the process env
   take precedence over `.env` — confirm via the `env: export …` line Expo CLI prints at start
   (the overridden var is silently absent from that list, meaning it wasn't re-sourced from
   `.env`).
4. **Fresh `uiautomator dump` immediately before every tap into scrollable/dynamic content —
   never reuse cached bounds.** `adb shell uiautomator dump /sdcard/w.xml && adb pull
   /sdcard/w.xml <local>` gives exact `bounds="[x1,y1][x2,y2]"` per element; tap the center. A
   dump taken even one screenshot ago can be stale after a scroll, an accordion
   expand/collapse, or a keyboard appearing — all of which shift Y-coordinates. Re-dump, don't
   estimate from a screenshot's pixel position (screenshots are captured at full device
   resolution, e.g. 1080×2400 — divide/multiply consistently if eyeballing from a downscaled
   preview).
5. **The fixed bottom tab bar silently swallows taps aimed at scrolled-under content sharing its
   Y-range.** A button whose `uiautomator` bounds report a Y inside the tab bar's own bounds
   (e.g. `[*, 2211][*, 2337]`) will not receive the tap — the tab bar sits on top in z-order and
   intercepts it, even though the accessibility tree still reports the underlying element's
   bounds as if it were tappable. Symptom: the tap silently navigates to a different tab instead
   of activating the intended control, with no error. Fix: scroll the content so the target's
   bounds clear the tab bar's Y-range before tapping, and re-dump to confirm the new bounds.
6. **Combine the tap and a delayed follow-up action in one `adb shell` invocation for
   sub-second timing precision** — `adb shell "input tap X Y && sleep 0.NN && input keyevent 4"`
   — rather than issuing them as separate `adb` calls, which each carry their own
   connection/protocol round-trip (tens of ms of jitter, enough to blow a ~300ms animation
   window). Run the same tap+delay+action sequence 2-3 times at different delays (e.g. 80ms,
   150ms, 250ms) spanning the window under test, not just once — a single trial doesn't rule out
   a race that only manifests at certain offsets.
7. **Prefer a synchronous, no-network trigger for animation-timing races over one that also
   depends on a mutation/AI call.** An action that closes a sheet via a plain `setState(null)`
   is reliably timeable; one that also awaits a network round-trip (e.g. an "AI estimates
   nutrition" flow that can take 1.6s+) makes the close-animation's actual start time
   unpredictable, and the back-press timing test degenerates into testing "did back fall
   through during a pending mutation" instead of "did it fall through during the close
   animation" — a different, less specific question. If the acceptance criteria's example
   trigger is network-backed, look for another state-driven UI element wired to the same
   underlying hook/mechanism that closes synchronously, and use that instead.

## Exceptions

- **A tab-root screen with no stack-pop target can make a back-press race UN-diagnosable via
  navigation outcome alone.** If pressing back with the sheet closed (a negative control) is
  already a visual no-op on that screen (confirm via `adb shell dumpsys activity activities |
  grep topResumedActivity` — the app stays foregrounded either way), then "nothing bad happened"
  after the timed back-press doesn't distinguish "the fix correctly consumed the event" from
  "it fell through to a no-op regardless." Say so explicitly in the write-up rather than
  overclaiming a device-confirmed causal proof — the existing unit-test coverage of the
  mechanism plus "no adverse outcome across repeated trials" is still a legitimate pass, just
  with the limitation named.
- `uiautomator dump` / `screencap` can hang on a live-camera or continuously-animating screen —
  same caveat as the TalkBack solution below; take screenshots only on a settled screen.
- A stale debug APK is only safe to reuse when **no** new RN-native dependency was added since
  its build date — a dev-only or server-only package addition (verified via reading the actual
  `package.json` diff, not just eyeballing the commit title) doesn't require a rebuild, but a
  new native module does.

## Related Files

- `client/hooks/useSheetBackHandler.ts` — the hook this session's verification targeted.
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — the screen hosting the sheets under test.

## See Also

- [Verify TalkBack behavior via emulator logcat](verify-talkback-behavior-via-emulator-logcat-2026-06-23.md) — the companion technique for screen-reader speech output specifically (different mechanism: logcat text, not tap coordinates)
- [gorhom onChange fires on animation complete, not start](../logic-errors/gorhom-onchange-fires-on-animation-complete-not-start-2026-07-07.md) — the underlying close-animation-grace-period mechanism this session verified on-device
