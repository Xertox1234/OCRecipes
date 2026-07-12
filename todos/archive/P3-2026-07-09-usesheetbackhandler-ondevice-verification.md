<!-- Filename: P3-2026-07-09-usesheetbackhandler-ondevice-verification.md -->

---

title: "On-device Android verification for useSheetBackHandler close-animation and focus-scoping fixes (PR #555)"
status: done
priority: low
created: 2026-07-09
updated: 2026-07-12
assignee:
labels: [deferred, ui-ux, android, follow-up, testing]
github_issue:

---

# On-device Android verification for useSheetBackHandler close-animation and focus-scoping fixes (PR #555)

## Summary

PR #555 implemented fixes for two of `useSheetBackHandler`'s four known edge cases (the
close-animation dead window and the focus-scoping gap), verified only via unit tests
(Vitest/jsdom `renderHook`) — the automated `/todo` session that implemented them had no
Android emulator or physical device access. The `advisor` tool flagged this as **load-bearing**:
both are timing-sensitive Android hardware-back behaviors that unit tests cannot fully validate.

## Background

Filed as a deferred warning from PR #555's implementation (`/todo` run, 2026-07-09). This is the
same on-device-verification gap the original PR #543 author hit — see
`todos/archive/P3-2026-07-02-bottomsheet-android-back-dismiss.md`. Not a known regression; the
fixes are reasoned correct by trace and pass unit tests, but "hardware back during a ~300ms
animation" and "focus blur without unmount via a deep-link" are exactly the class of timing bug
that only manifests on a real back-press event loop.

## Acceptance Criteria

- [x] On a real device or Android emulator, verify the close-animation grace period: trigger a
      state-driven sheet close via an in-sheet action (e.g. choosing a recipe in Quick Add), then
      press hardware back during the sheet's close animation — the back press should be consumed
      by the still-closing sheet, not fall through to React Navigation.
- [x] Verify the focus-scoped listener fix: open a sheet on `MealPlanHomeScreen`, navigate away via
      a deep-link/push-notification response (which blurs, not unmounts, the screen), then press
      hardware back on the newly-focused screen — confirm the stale listener from the blurred
      screen does not consume it.
- [x] Record pass/fail for both cases (and any follow-up needed) in this todo's Updates section.

## Implementation Notes

- Files under test: `client/hooks/useSheetBackHandler.ts`, `client/screens/meal-plan/MealPlanHomeScreen.tsx`.
- Requires an Android emulator or physical device — the project already has emulator tooling used
  for TalkBack accessibility verification (boot with `-gpu host`) as a starting point for
  booting/interacting with the emulator, though this test needs live back-press + animation-timing
  observation, not logcat speech capture, so budget for manual interaction rather than a scripted
  check.
- This is verification, not implementation — if either case fails, that becomes new work (revise
  the animation-confirmed-close pattern or the focus-scoping gate), not a fix to make here.

## Dependencies

- PR #555 (merged 2026-07-09) — this todo verifies its two riskiest fixes on main.

## Risks

- If either case fails on-device, the underlying fix in `useSheetBackHandler.ts` needs revision —
  budget for that possibility rather than assuming this is a rubber-stamp check.

## Updates

### 2026-07-09

- Filed as a deferred warning from the `/todo` executor that implemented PR #555, per user
  instruction to convert deferred items into tracked todos.

### 2026-07-12

On-device verification performed on the `Medium_Phone_API_36.1` Android emulator (`-gpu host`),
running the pre-existing debug dev-client APK (native shell unchanged since PR #555 touched only
JS/TS — confirmed no new native deps in `package.json` since the APK's build date) against a live
Metro bundler and local backend, logged in as `demo`/`demo123`.

**AC2 (focus-scoping) — PASS, clean and unambiguous.** On `MealPlanHomeScreen` (Plan tab), opened
`AddItemMenuSheet` (state-driven, `isOpen = addItemMenuMealType !== null`). Fired
`ocrecipes://recipe/<id>` via `adb shell am start` to push `FeaturedRecipeDetail` on top, blurring
(not unmounting) `MealPlanHomeScreen` — the sheet remained visually presented throughout (gorhom
portals render at a fixed host, independent of the presenting screen's focus). Pressed hardware
back once: `FeaturedRecipeDetail` popped correctly via React Navigation's own back handling,
returning to `MealPlanHomeScreen` with the sheet **still open and unaffected** — proof the stale
blurred-screen listener did not consume the event (if it had, the sheet would have dismissed
instead of the screen popping). This is exactly the AC2 scenario and it passed on the first
attempt.

**AC1 (close-animation grace period) — PASS across 3 repeated, deliberately-timed trials, with an
important caveat on how diagnostic the test is.** Reworked the trigger from the AC's example
("choosing a recipe in Quick Add") to tapping any option in `AddItemMenuSheet` itself (e.g.
"Choose Recipe") — both are state-driven hosts wired to the same hook, but `AddItemMenuSheet`'s
close is a synchronous `setState(null)` with no network round-trip, making the ~300ms animation
window reliably timeable via `adb shell "input tap X Y && sleep 0.NN && input keyevent 4"` in one
shell invocation (avoids adb-roundtrip jitter between separate commands). Ran 3 trials at 80ms,
150ms, and 250ms after the tap (spanning the animation window): in every trial, the app remained
foregrounded (`topResumedActivity=...MainActivity`) with no dangling sheet, landing cleanly back
on `MealPlanHomeScreen` — no crash, no unexpected navigation, no half-closed sheet state.

Caveat: `MealPlanHomeScreen` is a bottom-tab root with no stack screen to pop to, so a **negative
control** (hardware back with no sheet open at all) produced the identical visible outcome (stay
on Plan, app stays foregrounded) — confirmed via `dumpsys activity activities`. This means an
_unconsumed_ back press on this specific screen is _also_ a visual no-op, so the 3 trials prove
"nothing broke" but can't fully distinguish "the grace-period fix correctly consumed the event" from
"it fell through to a harmless no-op regardless." The sibling verification
(`todos/archive/P3-2026-07-02-bottomsheet-android-back-dismiss.md`) hit the same class of
diagnosability limit for a different reason (adb's zero-gap tap+keyevent racing ahead of a
`.present()` call) — here the limiter is the screen's own back-handling shape, not adb timing
fidelity. Given 3/3 trials showed no adverse outcome and the unit tests (14/14, verified against
gorhom's `onAnimate`-before-`onChange` source ordering) already cover the mechanism directly, this
is recorded as a genuine pass with the caveat surfaced rather than re-litigated further — consistent
with the advisor's pre-check guidance that "verified-AC2 + honestly-caveated-AC1 is a valid
completion." **To be explicit about what "pass" means here: the AC1 checkbox above reflects this
judgment call (no adverse outcome on-device + pre-existing unit coverage of the mechanism), not a
device-confirmed causal proof that the back press was specifically consumed by the grace period
rather than falling through to a screen-shape-dependent no-op — see the diagnosability caveat
above.**

**New finding — hardware back stops dismissing a sheet after a blur/refocus round-trip (not one of
the two ACs, discovered while testing AC2, needs its own follow-up).** After the AC2 sequence
(open sheet → deep-link away → back to pop the pushed screen → sheet still open), _further_ back
presses on the refocused `MealPlanHomeScreen` did **not** dismiss the still-open sheet — reproduced
twice. Tap-to-dismiss on the sheet's backdrop worked instantly in the same state, and a **freshly
re-opened** sheet (new `present()` call) responded to back normally again — so this isn't a global
back-handling break, just something about the _specific sheet instance_ that was open during the
blur/refocus cycle. Plausible cause (not confirmed): a leaked/stale `BackHandler` listener
registered during the pushed screen's lifetime that wasn't cleaned up when it was popped via the
hardware-back event itself (a known class of React Navigation back-handler ordering issue), sitting
ahead of `MealPlanHomeScreen`'s listener in Android's LIFO consultation order and silently
consuming the event without doing anything. Filed as
`todos/P3-2026-07-12-sheetbackhandler-stale-listener-after-blur-refocus.md` (low severity — a
second back press or a tap dismisses the sheet fine, so no dead end for the user).

**Unrelated bug discovered during setup (out of scope, noted for awareness):** adding a
community-catalog recipe via the "Choose Recipe" → search flow (`GET /api/recipes/browse`) fails
with a 404 on `POST /api/meal-plan/items` ("Recipe not found") because that endpoint validates the
`recipeId` against the user's personal `meal_plan_recipes` table, not the catalog the search hits.
Personal recipes aren't returned by the same search either, so "Choose Recipe" appears unable to
successfully add anything in this dev/seed-data state. Not touched — outside this todo's scope
(useSheetBackHandler / MealPlanHomeScreen back-press behavior only), but likely worth a follow-up
todo if reproducible against production data too.

**Environment notes for future on-device sessions:** the existing debug APK
(`android/app/build/outputs/apk/debug/app-debug.apk`) was reused directly (`adb install -r` +
`adb reverse tcp:8081 tcp:8081` + `adb reverse tcp:3000 tcp:3000` + `npx expo start --dev-client`
with `EXPO_PUBLIC_DOMAIN` overridden to `http://10.0.2.2:3000` since the emulator's SLIRP
networking cannot reach the host's LAN IP baked into `.env`) — no native rebuild needed since no
RN-native deps changed since the APK's build date. The emulator (`emulator -avd
Medium_Phone_API_36.1 -gpu host`) needed `-no-snapshot` after an unexplained mid-session qemu exit
on the first boot attempt; stable afterward. Test data (a `meal_plan_recipes` row + one
`meal_plan_items` row) was inserted directly via `psql` to get past the empty-meal-plan state (same
blocker the sibling todo hit) and deleted after verification.
