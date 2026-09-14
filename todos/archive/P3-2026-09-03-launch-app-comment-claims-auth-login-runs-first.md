---
title: "launch-app.yaml comment claims auth/login is always the first flow — measured order disproves it"
status: done
priority: low
created: 2026-09-03
updated: 2026-09-13
assignee:
labels: [deferred, testing]
github_issue:
---

# launch-app.yaml comment claims auth/login is always the first flow

## Summary

`e2e/helpers/launch-app.yaml`'s readiness-gate comment asserts that
`auth/login` "is always the first flow in path order". The measured flow
sequence from a real CI run shows three `Home - *` flows executing before it.

## Background

Found 2026-09-03 while diagnosing issue #908 (the sign-out alert timeout,
fixed in the `fix/e2e-logout-alert-timeout` PR). The comment reads:

> ensure-logged-out's wizard-escape recovers from it, and auth/login, which
> calls it, is always the first flow in path order.

Attempt-1 flow order, run `33826146222` (iOS, verbatim from the job log):

1. `Home - View item detail from history`
2. `Home - NutriCoach chat interaction`
3. `Home - Navigate between tabs`
4. `Auth - Login flow`
5. `Plan - Meal plan home and pantry`
6. `Plan - View and manage grocery lists`
7. `Scan - Barcode scanning flow`
8. `Scan - Photo analysis intent selection`
9. `Onboarding - Register and complete onboarding`

`auth/login` runs 4th, not 1st, and the order is not alphabetical by path
(`home` before `auth`; `onboarding` last rather than 3rd).

This matters beyond tidiness: the comment is load-bearing for reasoning about
stranded-state recovery. It tells a reader that nothing can precede
`auth/login`, so nothing can hand it a dirty app state — which is false, and
would misdirect the next person diagnosing a cascade failure.

## Acceptance Criteria

- [x] Determine what actually orders the flows (Maestro's own directory walk,
      a tag filter, or the workflow's invocation), and cite the mechanism.
- [x] Correct the claim in `e2e/helpers/launch-app.yaml` to match the real
      ordering guarantee — or state plainly that the order is not guaranteed,
      if that is what the mechanism implies.
- [x] Re-check whether any other comment in `e2e/` depends on the same
      "auth/login is first" premise.

## Implementation Notes

Comment-only change expected — no flow behaviour should need to move. If the
investigation shows the ordering is genuinely unspecified, that is a stronger
finding than a stale comment and should be surfaced rather than papered over
with reworded prose.

## Scope Contract

- **Mechanisms to use:** comment text only, unless the ordering investigation
  turns up a real defect.
- **Files in scope:** `e2e/helpers/launch-app.yaml`, plus any other `e2e/`
  file found to repeat the same premise.
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Low. Worst case the ordering turns out to be genuinely unspecified, which
  converts this into a real finding rather than a doc fix.

## Updates

### 2026-09-03

- Initial creation, deferred from the #908 timeout fix as out of scope.

### 2026-09-13

- The headline claim was already partially corrected on `main` by commit
  `3d4f85aa` (PR #924, 2026-09-05) as a side effect of the unrelated #908
  logout fix — it replaced "auth/login, which calls it, is always the first
  flow in path order" with "auth/login is NOT reliably first in path order
  (measured 4th; \<this todo's path\>)". That correction did not cite the real
  mechanism (AC #1 was still open) and embedded a live reference to this
  todo's pre-archive path, which would have gone stale the moment this todo
  archived (`docs/solutions/code-quality/a-retracted-claim-survives-in-every-artifact-you-did-not-grep-2026-09-03.md`'s
  "MOVE a file" addendum).
- Determined the actual mechanism (AC #1): `e2e/config.yaml` configures no
  `executionOrder`/`flowsOrder`, so Maestro's own documented default governs
  — flow execution order is **non-deterministic by design** ("intentional
  because testing Flows in isolation ensures they are robust and not
  dependent on side effects from previous tests" —
  docs.maestro.dev/maestro-flows/workspace-management/sequential-execution).
  This is stronger and version-independent versus the single-run "measured
  4th" evidence, which is now framed as one sample, not a property.
- Rewrote `e2e/helpers/launch-app.yaml`'s readiness-gate comment to state the
  mechanism, keep the single-run evidence as corroboration only, and repoint
  the todo reference at its post-archive path (`todos/archive/<this file>`).
- AC #3 sweep found one more file repeating the same false premise:
  `e2e/flows/onboarding/complete-onboarding.yaml`'s end-of-flow comment
  claimed the fresh e2etest session "leaks into every later flow in path
  order (plan/, scan/)" — falsified by the same measured run, in which
  onboarding actually ran LAST (9th), after both plan/ and scan/. Reworded to
  "leaks into whatever flow runs next" without naming a position.
- Code review (`code-reviewer`) also caught a pre-existing imprecision in the
  clause immediately adjacent to the edited claim ("every flow reaches that
  escape via the login helper's own wizard-strand gate") — two flows
  (`auth/login.yaml`, `complete-onboarding.yaml`) call
  `ensure-logged-out.yaml` directly rather than through the login helper's
  gate. Fixed inline in the same file/commit.
- No behavioural defect found — this was a documentation-accuracy fix only,
  per the Scope Contract.
