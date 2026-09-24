---
title: 'Closing QuickLogDrawer mid-submit lets a late error repopulate a stale "Failed to log items" banner'
status: in-progress
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, reliability]
github_issue:
---

# Closing QuickLogDrawer mid-submit lets a late error repopulate a stale "Failed to log items" banner

## Summary

`handleToggle` calls `session.reset()` while a `logAllMutation` submit may still be in flight. A late `onError` then writes `submitError` into the reset session, so reopening the drawer shows a stale failure banner with no items.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **L15** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/components/home/QuickLogDrawer.tsx:189-192`; `isSubmittingRef` tracks in-flight state; the session lives in `client/hooks/useQuickLogSession.ts` (which already epoch-guards stale parses — reuse that epoch for submits).

## Acceptance Criteria

- [ ] A submit result that arrives after a reset is ignored (epoch guard)
- [ ] Test: reset during an in-flight submit, then error → no banner on reopen
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

Reuse the existing epoch mechanism in useQuickLogSession.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/hooks/useQuickLogSession.ts`
  - `client/components/home/QuickLogDrawer.tsx`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Don't drop a genuine success's cache invalidation — only the UI error state should be epoch-guarded.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (L15).
