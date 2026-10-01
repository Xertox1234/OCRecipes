---
title: "HistoryScreen and useHistoryData can't be imported in the jsdom test harness — the screen has never had a test"
status: backlog
priority: medium
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, testing]
github_issue:
---

# HistoryScreen and useHistoryData can't be imported in the jsdom test harness — the screen has never had a test

## Summary

Importing `client/screens/HistoryScreen.tsx` or `client/hooks/useHistoryData.ts` in a Vitest jsdom test throws `SyntaxError: Unexpected token 'typeof'` from somewhere in their imports. So History, a main-tab screen, has no test at all.

## Background

Found by the #1101 executor (skeleton loaders, 2026-09-25). The executor rated it High, and the user approved filing it as P2.

- The error reproduces on `main` with the pre-existing files, so #1101 did not cause it.
- About 15 transitive imports were bisected, and each passes when imported on its own. No single culprit was found, so the trigger is probably a combination or an import order.
- #1101 added a delayed "Loading" announcement to HistoryScreen. Its logic, including History's `isLoading && !isError` gate, is covered through the shared hook `useDelayedLoadingAnnouncement` (`client/hooks/__tests__/useDelayedLoadingAnnouncement.test.ts`). Only the screen's one-line wiring is untested.
- A related finding in the same investigation: `@/context/AuthContext` and `@/context/PremiumContext` each throw `Cannot find module './setupFastRefresh'` (Expo's dev-only async-require path) when imported on their own. Auth is high-risk; note this, but don't change `AuthContext` as part of this todo.

## Acceptance Criteria

- [ ] Find which import (or combination) produces `Unexpected token 'typeof'`, and record the cause in this todo.
- [ ] Fix it in the test setup (a mock, a `vitest.config` transform or `deps.inline` entry, or a `test/mocks/` module), not by changing production code, unless the cause is genuinely a production-code problem.
- [ ] Add `client/screens/__tests__/HistoryScreen.test.tsx` with at least: the loading skeleton is hidden from screen readers (`aria-hidden` on both skeleton render sites), and the delayed "Loading" announcement fires once, and doesn't fire when `isError` arrives first.
- [ ] Record whether the AuthContext/PremiumContext `setupFastRefresh` error shares the same cause. Fix it only if the fix lives entirely in the test harness.

## Implementation Notes

- Start from a minimal test that only imports `HistoryScreen`, then bisect by mocking its imports one at a time (`vi.mock`) until the error disappears.
- `Unexpected token 'typeof'` often means an untransformed ESM/Flow file from `node_modules` is being loaded. Check the Vitest `server.deps.inline` / `transformIgnorePatterns`-style config in `vitest.config.mts`.
- The sibling skeleton-screen tests (`client/screens/__tests__/CoachProScreen.test.tsx`, `PhotoAnalysisScreen.test.tsx`) show the expected shape.

## Scope Contract

- **Mechanisms to use:** test-harness configuration and mocks; one new screen test file.
- **Files in scope:** `vitest.config.mts`, `test/mocks/**`, `test/setup*`, `client/screens/__tests__/HistoryScreen.test.tsx` (new).
- No production-code changes unless the root cause is in production code; disclose it if so. Never modify `client/context/AuthContext.tsx`.

## Dependencies

- None
