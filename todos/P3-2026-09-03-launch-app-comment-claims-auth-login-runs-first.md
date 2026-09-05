---
title: "launch-app.yaml comment claims auth/login is always the first flow — measured order disproves it"
status: backlog
priority: low
created: 2026-09-03
updated: 2026-09-03
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

- [ ] Determine what actually orders the flows (Maestro's own directory walk,
      a tag filter, or the workflow's invocation), and cite the mechanism.
- [ ] Correct the claim in `e2e/helpers/launch-app.yaml` to match the real
      ordering guarantee — or state plainly that the order is not guaranteed,
      if that is what the mechanism implies.
- [ ] Re-check whether any other comment in `e2e/` depends on the same
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
