---
title: "Rate-limit detection by message regex, inconsistent log-error copy, and an untyped navigate cast in ScanScreen"
status: done
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, code-quality]
github_issue:
---

# Rate-limit detection by message regex, inconsistent log-error copy, and an untyped navigate cast in ScanScreen

## Summary

Three small consistency issues in how the client handles API errors and navigation typing.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **L4, L5, L7** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- L4: `client/screens/SettingsScreen.tsx:138` uses `/^429:/.test(error.message)` instead of `error instanceof ApiError && error.code === ErrorCode.RATE_LIMITED` (the pattern used at LabelAnalysisScreen.tsx:185, CoachChat.tsx:261-263).
- L5: `client/screens/ScanScreen.tsx:315-318` `handleConfirmLog` shows a generic error for every failure of `POST /api/scanned-items`, while NutritionDetail's path (useNutritionLookup.ts:974-981) branches RATE_LIMITED.
- L7: `client/screens/ScanScreen.tsx:891-899` casts `navigation.navigate as (screen: string, params?) => void`, which erases param typing (runtime-safe today).

## Acceptance Criteria

- [x] SettingsScreen checks `ApiError.code`
- [x] ScanScreen confirm-log error branches RATE_LIMITED the same way as NutritionDetail
- [x] The navigate cast is replaced with a typed call (discriminated on the route)
- [x] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Three small independent changes; one PR is fine.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/SettingsScreen.tsx`
  - `client/screens/ScanScreen.tsx`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- None.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (L4, L5, L7).

### 2026-09-24

- Implemented all three findings:
  - L4: `SettingsScreen.tsx` `performExport` now branches on `error instanceof ApiError && error.code === ErrorCode.RATE_LIMITED` instead of `/^429:/.test(error.message)`.
  - L5: `ScanScreen.tsx` `handleConfirmLog`'s catch now branches the same way, showing a rate-limit-specific toast instead of the same generic message for every failure.
  - L7: `ScanScreen.tsx`'s `onSmartPhotoConfirm` navigate dispatch replaced the `navigation.navigate as (...) => void` cast with a `switch` on the `ClassificationRoute` discriminated union's `screen` field — one typed `navigation.navigate(literal, params)` call per arm, plus an exhaustiveness guard (`const _exhaustive: never = action.route`) matching the sibling `switch (action.kind)`'s existing convention in the same file.
- TDD: new failing-then-passing tests added for L4 (`SettingsScreen.test.tsx`) and L5 (`ScanScreen.test.tsx`) — both confirmed red against the pre-fix code (rate-limit copy asserted, old regex didn't match a RATE_LIMITED error without a literal `"429:"` message prefix) and green after. L7 is a type-only refactor with no behavioral change (verified via `tsc`); no runtime test can discriminate pre- from post-change for it, so none was fabricated — the existing `mockNavigate` assertions and the type checker are its regression coverage.
- Review: `code-reviewer` + `mobile-reviewer`, both "No blocking findings." Both independently flagged the same WARNING (missing exhaustiveness guard on the new switch) — fixed inline in a follow-up commit on the same branch, matching the existing sibling-switch convention in `ScanScreen.tsx`.
- Verified `.env` was missing from this worktree (a known gap for `Agent(isolation:"worktree")` dispatches); symlinked from the main checkout, after which the full `npm run test:run` (8644 tests) passed cleanly.
