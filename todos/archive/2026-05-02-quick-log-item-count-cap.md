---
title: "Cap logAllMutation item count to prevent rate-limit bypass"
status: in-progress
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, security]
---

# Cap logAllMutation item count to prevent rate-limit bypass

## Summary

`logAllMutation.mutationFn` fires N parallel POSTs with no client-side item count cap. Typical voice parse yields 3–5 items but crafted input can produce ~10–15, bypassing per-item rate-limiting intent.

## Background

Deferred from 2026-05-02 full audit (finding L12). `client/hooks/useQuickLogSession.ts` lines 114-128. A server-side check on batch size would be more robust, but a client-side cap of e.g. 10 items provides a reasonable first defense.

## Acceptance Criteria

- [ ] `logAllMutation.mutationFn` caps items at a maximum of 10 (configurable constant)
- [ ] If items exceed the cap, the mutation logs the first 10 and shows a toast explaining the cap

## Implementation Notes

Add `const MAX_LOG_ITEMS = 10;` constant and slice in `mutationFn`. Alternatively, cap in the `submitLog` callback before calling `mutate`.

## Dependencies

- None

## Risks

- Edge case: legitimate bulk logging (e.g. meal with many components) may be truncated. Consider 15 as a more generous cap.

## Updates

### 2026-05-02

- Initial creation (deferred from audit L12)
