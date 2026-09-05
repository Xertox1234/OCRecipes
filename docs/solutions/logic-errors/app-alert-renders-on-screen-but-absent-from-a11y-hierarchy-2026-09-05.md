---
title: An app-owned native alert can render on screen while ABSENT from the accessibility hierarchy — no hierarchy wait can ever see it
track: bug
category: logic-errors
tags: [testing, react-native, accessibility, maestro, e2e, ios]
module: client
applies_to: ["e2e/**", "client/screens/**/*.tsx"]
symptoms: ["an E2E wait/assert on an Alert.alert's text times out while the failure screenshot shows the alert fully rendered", "raising the wait's timeout consumes exactly the extra budget and still fails", "the flow that runs NEXT inherits a stranded app (the un-dismissable alert still blocks it) and dies on an unrelated gate", "the same flow passes on a local simulator every time — CI-only"]
created: 2026-09-05
severity: high
---

# An app-owned native alert can render on screen while ABSENT from the accessibility hierarchy — no hierarchy wait can ever see it

## Problem

`ensure-logged-out.yaml` tapped the Settings "Sign Out" row, which fired a
React Native `Alert.alert` confirmation. On the CI iOS simulator the alert
**rendered on screen** — the attempt-1 failure screenshot (run 33935553286)
shows title, message, Cancel and Sign Out buttons — but the same moment's
hierarchy dump contained **no alert nodes at all**, just the Settings screen
behind it. The `extendedWaitUntil` on the alert's message text timed out,
the flow failed, and the still-open alert stranded the app so the next flow
(`Plan - Meal plan home`) inherited an **empty** hierarchy and died too: one
cause, two red flows, in 6 of 7 consecutive nightly runs (issue #908).

## Symptoms

See frontmatter. The discriminator is the screenshot/hierarchy **pair** from
the same instant: alert in the picture + no alert in the dump = this bug.
(Compare the sibling failure mode where a SYSTEM dialog is in the dump and
the app tree is gone — the inverse signature, different doc, see below.)

## Root Cause

A `UIAlertController` lives in its own iOS window. Its accessibility exposure
to the XCTest snapshot Maestro reads is a separate step from rendering, and on
a contended CI simulator that exposure can wedge for 30+ seconds — measured:
raising the wait 10s→30s (closed PR #919) consumed the full extra budget and
still failed, because **no hierarchy wait can see a node that never enters the
hierarchy**. Three earlier hypotheses (slow alert, off-screen tap target,
"iOS 26 hides alerts") were each disproven; the decisive evidence only became
capturable when the CI artifact upload switched to `if: always()` (PR #921) so
attempt-1 dumps survived the retry's green job.

Two traps compounded the diagnosis:

- **A local disproof does not transfer to CI.** "The alert appears in the
  tree" was verified on a local sim and true there every time — the CI-only
  wedge is a load/environment behavior, not a code path a local repro can
  falsify.
- **Maestro reports occluded/invisible-target taps as COMPLETED** whenever
  the UI changed at all, so nothing in the passing steps hints the target
  was unreachable.

## Solution

**Scope of this fix (bounded 2026-09-05 by validation run 33939156004):** the
migration below removes the *alert-invisibility* mechanism — the in-app sheet
IS exposed to the hierarchy (its container appears in the dump) where the
native alert was not. It is **necessary but NOT sufficient** to make the CI
logout flow green: that validation run still failed both logout flows twice,
now because the **native `expo-splash-screen` launch screen
(`SplashScreenLogo`) re-appeared full-screen over the presented sheet** so its
content never became visible/tappable. That deeper cause — why the RN root
stops painting mid-logout on the contended CI sim — is tracked separately and
is NOT resolved by this migration. Do not cite this doc as closing #908.

Do not require an E2E flow to drive an app-owned native alert. Move the
confirm into the app's own view tree, where its exposure is deterministic:

- The sign-out confirm became the existing `useConfirmationModal` bottom
  sheet (`client/components/ConfirmationModal.tsx`), matching the in-app
  modals already used by the same Settings screen.
- Give the confirm action a label distinct from every sibling string —
  `confirmLabel: "Yes, Sign Out"` — so the flow taps one unique full-string
  match instead of a positional `index:` that can silently reorder
  (Maestro's `index` sorts by y/x bounds, not tree order).
- Carry the OS announcement forward: `Alert.alert` got its title/message
  read by VoiceOver for free; an in-app replacement must announce its own
  purpose on open (see the on-open-announce convention).

## Prevention

- Treat any `Alert.alert` a Maestro flow must *interact with* (not merely
  dismiss defensively) as a reliability hazard: prefer an in-app confirm
  surface. System dialogs (Save Password etc.) can't be migrated — gate on
  their text and dismiss, per the sibling doc below.
- When an alert-text wait fails on CI, read the screenshot and the hierarchy
  dump **as a pair** before touching timeouts. "Visible in one, absent from
  the other" ends the timeout line of inquiry immediately.
- Do not extrapolate a hierarchy-behavior disproof from a local simulator to
  CI; only a CI attempt-1 artifact settles it.

## Related Files

- `client/screens/SettingsScreen.tsx` — sign-out confirm via `useConfirmationModal`
- `client/components/ConfirmationModal.tsx` — the in-app sheet (announce-on-open included)
- `e2e/helpers/ensure-logged-out.yaml` — taps the unique "Yes, Sign Out" label
- `e2e/helpers/launch-app.yaml` — interrupted-logout recovery, same selector
- `.github/workflows/e2e-regression.yml` — the `if: always()` uploads that made the evidence capturable

## See Also

- [An iOS system dialog REPLACES the app's accessibility hierarchy](ios-system-dialogs-replace-the-a11y-hierarchy-2026-08-30.md) — the inverse signature: dialog in the dump, app tree gone. That doc's index-disambiguation example (the old Sign Out alert) is retired by this migration; its system-dialog guidance stands.
- [Diagnose E2E failures from the run's own hierarchy artifacts first](../best-practices/diagnose-e2e-from-debug-output-artifacts-first-2026-08-30.md) — the practice that produced the decisive screenshot/dump pair
- [On-open announces must be delayed past the present focus shift](../conventions/on-open-announce-must-delay-past-modal-present-focus-shift-2026-06-25.md) — the announce a native→in-app migration must add
