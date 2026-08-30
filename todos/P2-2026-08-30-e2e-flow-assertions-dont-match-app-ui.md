---
title: "E2E flow assertions don't match what the app actually shows for a fresh/free/unonboarded-default test account"
status: backlog
priority: medium
created: 2026-08-30
updated: 2026-08-30
assignee:
labels: [e2e, maestro, testing]
github_issue:
---

# E2E flow assertions don't match actual app UI

## Summary

Now that `todos/P2-2026-08-15-e2e-regression-workflow-has-never-passed.md`'s session/`clearState`
contamination bug is fixed (dispatch 9, run 33292071278 — confirmed cross-platform), 6 of the 8
regression-tagged flows get past login cleanly and fail on their own feature-specific
assertions instead. These are real, reproducible, consistent-across-both-platforms-and-both-attempts
failures — not flakiness — but a different class of problem than that todo's premise: the flows
assert things that apparently aren't true for the seeded `testuser` account's actual state
(`subscriptionTier: "free"`, `displayName: null`, freshly registered).

## Background

Split off from the E2E-regression-commissioning todo per its 2026-08-30 update, on explicit
advisor review: that todo's premise ("the workflow has never run") is resolved, and continuing
to chase these failures there would conflate two different kinds of defect (CI plumbing vs.
flow-content accuracy) in one todo whose scope has already shifted twice.

## Failing flows (dispatch 9, both platforms, both attempts — consistent, not flaky)

| Flow                                     | Failure                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `Home - View item detail from history`   | `Element not found: Text matching regex: Profile`                                                     |
| `Home - NutriCoach chat interaction`     | `Assertion is false: "NutriCoach" is visible`                                                         |
| `Home - Navigate between tabs`           | `Assertion is false: "Hello" is visible`                                                              |
| `Plan - Meal plan home and pantry`       | `Element not found: Text matching regex: Plan` (pre-existing since 2026-08-16, never session-related) |
| `Scan - Barcode scanning flow`           | `Element not found: Text matching regex: Scan`                                                        |
| `Scan - Photo analysis intent selection` | `Element not found: Text matching regex: Scan`                                                        |

Two unverified leads (named as leads, not diagnoses — confirm before acting):

- `NutriCoach` may be premium-gated (project memory: Coach is premium-gated on 2 surfaces) and
  the seeded account is `subscriptionTier: "free"` — check what actually renders instead (a
  paywall? a different label?) via a screenshot/hierarchy dump at the failure point before
  assuming this is the cause.
- `"Hello"` may depend on `displayName`, which is `null` for a freshly registered account (no
  name set at registration) — check whether the greeting renders a fallback, a different string,
  or nothing at all for a nameless user.

Also worth checking as part of this work: iOS `Onboarding - Register and complete onboarding`
fails in ~2s with no error message on dispatch 9 (both attempts) — a different, unexplained
signature from Android's version of the same flow (`"Sign In" is visible`, ~1m41s). Not
diagnosed at all yet.

## Acceptance Criteria

- [ ] Each of the 6 failing flows above either passes, or its assertion is corrected to match
      real, intended app behavior for the test account it's given (verified against actual
      screenshots/hierarchy dumps, not guessed).
- [ ] The two unverified leads above are confirmed or falsified with real evidence before any
      fix is written against them.
- [ ] iOS's ~2s blank-message failure on `Onboarding - Register and complete onboarding` is
      diagnosed (currently completely unexplored).
- [ ] At least one `workflow_dispatch` run shows these flows passing (not merely "further along"
      — this repo's own prior E2E-commissioning history is proof that a partial fix reported as
      done gets re-litigated later).
- [ ] The nightly `schedule:` trigger in `.github/workflows/e2e-regression.yml` is re-enabled
      after a genuinely green `workflow_dispatch` run on `main` (the pause note in the workflow
      file spells out the condition — this checkbox exists because prose-only re-enable
      instructions are exactly how the original 34-failure drift happened: nothing tracked it).

## Implementation Notes

- Verify by dispatching (`workflow_dispatch` on a branch), not by reading — same discipline as
  the parent todo, which found guessed fixes repeatedly wrong across 9 dispatches.
- Consider whether the seeded test account needs a `displayName` and/or a premium
  `subscriptionTier` set (extending the existing "Seed E2E test user" CI step, same pattern as
  the `onboardingCompleted: true` fix) rather than changing app code or flow assertions, if the
  app's real behavior for a free/nameless account turns out to be correct as-is.
- `Plan - Meal plan home and pantry`'s failure predates all of this session's work (first seen
  2026-08-29 dispatch 5) and has never been investigated — don't assume it shares a cause with
  the newer 5 findings just because they surfaced together.

## Scope Contract

- **Mechanisms to use:** the existing `.github/workflows/e2e-regression.yml`, its
  `workflow_dispatch` trigger, and the existing Maestro flows under `e2e/`.
- **Files in scope:** `e2e/flows/**`, `e2e/helpers/**`, `.github/workflows/e2e-regression.yml`
  (seed-step changes only), and read-only inspection of `client/` to understand actual app
  behavior. Do not change `client/`/`server/` app behavior unless a flow's assertion turns out
  to be correct and the app itself is the thing that's wrong — that would be a genuine product
  bug, surface it rather than silently fixing it in scope here.

## Dependencies

- None — the session/`clearState` contamination fix this depends on is already merged into
  `todos/P2-2026-08-15-e2e-regression-workflow-has-never-passed.md`'s branch as of dispatch 9
  (commit `6699d871`).

## Risks

- Each of the 6 flows may have its own distinct cause — treat them as independent
  investigations, not one shared root cause, unless evidence says otherwise (the parent todo's
  own history is full of "looks like one bug, turns out to be several").

## Updates

### 2026-08-30

- Filed after dispatch 9 of the parent todo confirmed the session-contamination bug fixed and
  exposed these as the actual remaining blockers to a green E2E run.

### 2026-08-30 (later) — all 6 investigated and fixed at zero CI cost; NOT six independent causes

Evidence: dispatch-9's own artifacts (per-flow Maestro screen-hierarchy dumps, both platforms)
plus a local simulator/emulator loop. The risk note above was half right: it was not six
independent causes, but it was also not the two guessed leads — **both "unverified leads" are
falsified** (the greeting renders "Hello testuser" via the username fallback, never a bare
"Hello"; free tier is NOT paywalled on Coach — it lands on ChatList whose header IS
"NutriCoach").

The dominant shared cause: **Maestro text matching is full-string regex**, and the app's tab
buttons exposed aggregated ", Plan"-style accessibility labels (custom tabBarLabel render fn
suppresses bottom-tabs' derived label) with no testIDs, while the Scan FAB's label is
"Open scan menu" and chat.yaml asserted "NutriCoach" on a screen that never renders it.
Fixes: explicit `tabBarAccessibilityLabel` + `tabBarButtonTestID` on the four tabs (commit
`0766754a` — also fixes the real TalkBack announcement defect), flows tap tabs by id and
assert strings the app actually renders (`Hello.*`, "Browse Recipes", "Scan History.\*",
Coach-tab → "NutriCoach"), and the scan flows gained a mandatory SpeedDial assertion so they
are no longer vacuous (commit `ca3216b7`). Two in-scope app defects surfaced by this work were
fixed at source per the scope contract's "app is the thing that's wrong" clause: the
expo-notifications bogus custom sound (its LogBox toast covered the login screen's bottom
controls — `fa669060`) and the tab a11y labels above.

All 6 flows pass locally (Android 8/8; iOS green for all six of THESE flows). Verification on
CI rides the parent todo's dispatch 10 (run 33322868083). This todo closes when the parent's
green run lands — the full mechanism-by-mechanism record lives in the parent todo's
2026-08-30 investigation entry.

### 2026-08-30 (final) — all six flows green on CI, both platforms

Run 33332969400 (parent todo's dispatch 13): fully green on iOS and Android — every one of
the six flows this todo tracks passed on CI, plus the register/auth pair. First three
acceptance criteria met (assertions corrected against hierarchy evidence; both leads
falsified; the iOS 2s failure diagnosed as a wrong-bundle-id `launchApp` clearState error,
eliminated with clearState itself). Remaining open item: the schedule re-enable checkbox —
gated on a green `workflow_dispatch` on `main` after the parent branch merges.
