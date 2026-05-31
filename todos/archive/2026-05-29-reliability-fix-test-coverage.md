---
title: "Test coverage for the reliability-audit fix branches (validation fallthrough, push timeout, deep-link not-found)"
status: done
priority: low
created: 2026-05-29
updated: 2026-05-29
assignee:
labels: [deferred, testing, reliability]
github_issue:
---

# Test coverage for reliability-audit fix branches

## Summary

The 2026-05-29 reliability audit (PR #269) added new failure-mode branches that are covered for regressions (happy-path tests pass) but have no **dedicated** tests for the failure path itself.

## Background

Surfaced in the PR #269 code review. The new branches:

- `server/services/nutrition-lookup.ts` — CNF/USDA-UPC `safeParse` failure → fall through to next source (incl. the Phase-6 null-tolerance: USDA `value: null`, nullish `description`/unused CNF fields).
- `server/services/push-notifications.ts` — the per-chunk `Promise.race` send timeout.
- `client/screens/NotebookEntryScreen.tsx` — `entryId === 0` (malformed deep link) → load-aware not-found; `isError` → retry vs not-found.

## Acceptance Criteria

- [ ] nutrition-lookup: a malformed/`null`-bearing CNF or USDA-UPC response is tolerated (valid sibling still matched) AND a wholly-invalid response falls through without throwing.
- [ ] push-notifications: a hung `sendPushNotificationsAsync` is bounded by `PUSH_SEND_TIMEOUT_MS` (use fake timers) and the chunk error path still cleans up.
- [ ] NotebookEntryScreen: `entryId` omitted → create; `entryId = 0` (loaded, absent) → not-found; query `isError` → error+retry; valid cold-load entry populates fields.

## Implementation Notes

- Model the nutrition-lookup cases on the existing 18 mocked-`fetch` tests in `server/services/__tests__/nutrition-lookup.test.ts`.
- NotebookEntryScreen has no co-located test today — a render test needs the RTL/jsdom setup + mocking `useNotebookEntries`/`useRoute`.

## Risks

- Low — additive test-only work.

## Updates

### 2026-05-29

- Created from the PR #269 review (new failure-mode branches lacked dedicated tests).
