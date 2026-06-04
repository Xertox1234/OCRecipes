---
title: "Add tests for QueryErrorToastBridge subscribe/unsubscribe/toast lifecycle"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Add tests for QueryErrorToastBridge subscribe/unsubscribe/toast lifecycle

## Summary

`QueryErrorToastBridge.tsx` has no test. `SessionExpiryBridge` has full lifecycle tests; `QueryErrorToastBridge` subscribe/unsubscribe/toast call paths are untested.

## Background

Deferred from 2026-06-03 full audit (L18). File: `client/components/QueryErrorToastBridge.tsx`.

## Acceptance Criteria

- [ ] Test that the bridge subscribes to query-client error events on mount
- [ ] Test that the bridge unsubscribes on unmount (no memory leak)
- [ ] Test that a query error triggers the expected toast call
- [ ] Test that auth errors (401) are excluded from toast (if that behavior exists)

## Implementation Notes

Model after `SessionExpiryBridge` tests. Use `// @vitest-environment jsdom`. Mock the toast library and query-client error emitter. Extract pure functions from the bridge if needed to make them independently testable.

## Dependencies

- None

## Risks

- Low — new test file only

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L18)
