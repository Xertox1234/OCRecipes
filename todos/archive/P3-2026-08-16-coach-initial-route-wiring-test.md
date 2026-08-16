---
title: "Pin ChatStackNavigator's coachInitialRoute call-site wiring"
status: done
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, testing]
github_issue:
---

# Pin ChatStackNavigator's coachInitialRoute call-site wiring

## Summary

PR #826 extracted `coachInitialRoute(isCoachPro)` and unit-tested the decision, but nothing pins the call site: `initialRouteName={coachInitialRoute(!isCoachPro)}` (or passing the wrong variable) would keep both unit tests green. The `isPremiumResolved` mount guard — whose own comment records the historical Pro-users-locked-to-ChatList bug — is equally untested.

## Background

The pure-utils-extraction trap (`docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md`), flagged as the one accepted-residual WARNING in PR #826's review. A full navigator render test was deliberately not written there: no navigator render harness exists anywhere in the repo, and inventing one inside a test-coverage PR was scope creep.

## Acceptance Criteria

- [ ] A test fails if the navigator's `initialRouteName` stops following `isCoachPro` (either a minimal render harness asserting the mounted initial screen flips with the flag, or a `vi.mock("./coachInitialRoute")` spy asserting it is invoked with the real `isCoachPro` value)
- [ ] The `isPremiumResolved` mount guard gets at least one test: unresolved premium renders the loading/error state, NOT the navigator
- [ ] Any new render-harness pattern is documented (it would be the repo's first navigator render test)

## Implementation Notes

The spy approach is far cheaper than a native-stack render harness: mock `@/hooks/usePremiumFeatures` + `@/context/PremiumContext` (see `client/screens/__tests__/CoachProScreen.test.tsx` for the controllable-mock shape), mock `./coachInitialRoute` with a spy re-exporting the real implementation, render `ChatStackNavigator` with navigation/native-stack doubles, and assert the spy's argument. Weigh whether the doubles cost more than they prove before choosing the full-render path.

## Scope Contract

- **Mechanisms to use:** existing renderComponent harness + vi.mock doubles — no new test infra unless the render path is chosen, in which case document it.
- **Files in scope:** `client/navigation/__tests__/**`, `client/navigation/ChatStackNavigator.tsx` (test-only; no production change).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #826 merged.

## Risks

- A heavy navigator harness could be more maintenance than the wiring risk it covers — the spy variant avoids that.

## Updates

### 2026-08-16

- Initial creation from PR #826 review residual.
- Implemented: `client/navigation/__tests__/ChatStackNavigator.test.tsx` — mocks
  `createNativeStackNavigator` to a thin `Navigator`/`Screen` double so the test
  asserts the actual `initialRouteName` prop (stronger than spying on the pure
  `coachInitialRoute` call args). Two tests pin AC1 (Pro → CoachPro, free →
  ChatList); a mutation test (temporarily inverting the wiring to
  `coachInitialRoute(!isCoachPro)`) confirmed both go red, then reverted clean —
  proof the tests aren't vacuous. Three tests pin AC2's `isPremiumResolved`
  guard: loading, hard-error retry (with `refreshSubscription` wiring pinned),
  and the previously-untested resolved-but-currently-erroring cell (guard's
  `isError && !isPremiumResolved` conjunct). AC3: extended
  `docs/solutions/conventions/rn-component-render-test-jsdom-pattern-2026-05-16.md`
  with a "Rendering a navigator" section. No production change to
  `ChatStackNavigator.tsx` (Scope Contract honored).
