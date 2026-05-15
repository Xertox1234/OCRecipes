---
title: "Code quality: test coverage gaps + lint warnings (2026-04-28 audit)"
status: in-progress
priority: medium
created: 2026-04-28
updated: 2026-04-28
assignee:
labels: [testing, code-quality]
---

# Code Quality: Test Coverage Gaps + Lint Warnings

## Summary

`createWithKey` session method has zero tests. The coach history truncation path is not exercised at integration-test level. Three ESLint warnings remain. Several dead exports and a misleading unused parameter.

## Background

From the 2026-04-28 audit (H5-code, M16, M17, L14, L15, L16, L17).

Note: H5 (`createWithKey` zero tests) is the highest-priority item here — it covers complex quota-accounting logic with no test coverage.

## Acceptance Criteria

- [ ] **H5** `sessions.test.ts` — add tests for `createWithKey`: successful replacement, global cap after accounting for freed slot, per-user cap, replacement by a different user
- [ ] **M16** `coach-pro-chat.test.ts` — add integration test where `getChatMessages` returns 20 messages exceeding 8000 tokens; verify `generateCoachResponse` receives the truncated history
- [ ] **M17** `coach-pro-chat.test.ts:706` — add test asserting two dates in adjacent ISO weeks produce different `hashNotebookDedupeKey` values for `"coaching_strategy"`
- [ ] **L14** Remove unused imports: `beforeEach` in `sessions.test.ts:1`, `sql` in `weight-log-dedup.test.ts:12`, `ToolErrorResult` in `nutrition-coach.ts:14`
- [ ] **L15** `ParsedReceipt`, `ParsedMenu`, `ParsedFrontLabel` — either remove the `export` keyword (internal types) or use them in call sites
- [ ] **L16** `mergeReceiptItems` (`receipt-review-utils.ts:28`) — document the `_local` parameter with a TODO comment explaining the future merge intent, or remove the parameter if not needed
- [ ] **L17** Remove redundant `as Allergy[] | null` cast in `coach-pro-chat.ts:258`

## Implementation Notes

For H5: `createWithKey` is called by the warm-up flow. The test needs to use `makeStore({ maxPerUser, maxGlobal })` as established by the existing sessions test helpers, then call `createWithKey` directly.

## Updates

### 2026-04-28

- Created from audit findings H5 (code quality), M16, M17, L14, L15, L16, L17
