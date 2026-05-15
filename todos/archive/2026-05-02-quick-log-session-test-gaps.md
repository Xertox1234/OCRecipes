---
title: "Fill test gaps in useQuickLogSession and QuickLogDrawer"
status: done
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, code-quality, testing]
---

# Fill test gaps in useQuickLogSession and QuickLogDrawer

## Summary

Two test coverage gaps identified:

1. `handleVoicePress` stop-listening branch (`isListening: true` → calls `stopListening`) has no test; mocked `stopListening` is never asserted against (L17)
2. `QuickLogDrawer` missing tests for: `speechError` toast, `submitError` display, camera button navigation, `isSubmitting` ActivityIndicator state (L18)

## Background

Deferred from 2026-05-02 full audit (findings L17 + L18). `client/hooks/__tests__/useQuickLogSession.test.ts` and `client/components/home/__tests__/QuickLogDrawer.test.tsx`.

## Acceptance Criteria

- [ ] `handleVoicePress` test: when `isListening=true`, calling `handleVoicePress` calls `stopListening`
- [ ] `QuickLogDrawer` test: `speechError` triggers toast.error
- [ ] `QuickLogDrawer` test: `submitError` renders error text
- [ ] `QuickLogDrawer` test: camera button press navigates to `Scan` with `returnAfterLog: true`
- [ ] `QuickLogDrawer` test: `isSubmitting=true` renders `ActivityIndicator` instead of "Log All" text

## Implementation Notes

The `QuickLogDrawer` tests mock `useQuickLogSession` — add mock variants that set `speechError`, `submitError`, `isSubmitting`. For camera button navigation test, spy on `navigation.navigate`.

## Dependencies

- None

## Risks

- None

## Updates

### 2026-05-02

- Initial creation (deferred from audit L17 + L18)
