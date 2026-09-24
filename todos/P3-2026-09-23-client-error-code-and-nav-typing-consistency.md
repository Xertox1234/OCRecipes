---
title: "Rate-limit detection by message regex, inconsistent log-error copy, and an untyped navigate cast in ScanScreen"
status: in-progress
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

- [ ] SettingsScreen checks `ApiError.code`
- [ ] ScanScreen confirm-log error branches RATE_LIMITED the same way as NutritionDetail
- [ ] The navigate cast is replaced with a typed call (discriminated on the route)
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

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
