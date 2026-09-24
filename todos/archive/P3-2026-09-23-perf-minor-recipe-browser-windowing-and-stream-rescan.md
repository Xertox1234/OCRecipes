---
title: "RecipeBrowser section list has no windowing props, and useCoachStream re-scans the whole accumulated response on each SSE event"
status: done
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, performance]
github_issue:
---

# RecipeBrowser section list has no windowing props, and useCoachStream re-scans the whole accumulated response on each SSE event

## Summary

Two minor performance items: the recipe results list lacks `FLATLIST_DEFAULTS` windowing, and the coach stream parser re-scans the full accumulated text on every SSE event, which is O(n²) over a response.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **L9, L10** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- L9: `client/screens/meal-plan/RecipeBrowserScreen.tsx:991-1043` `AnimatedSectionList` (paginated, PAGE_SIZE 20) doesn't spread `FLATLIST_DEFAULTS` (`client/constants/performance.ts`). Research: `confirmed`, low.
- L10: `client/hooks/useCoachStream.ts:236-243` → `stripCoachBlocksFence` (`client/components/coach/coach-chat-utils.ts:37-47`) runs on the full text each event.

## Acceptance Criteria

- [ ] RecipeBrowser list spreads `FLATLIST_DEFAULTS` (spread-first, per docs/rules/performance.md)
- [ ] Fence stripping is incremental (tracks the scanned offset) with unit tests for split fences across chunks
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

L10 is only worth it if cheap and well-tested — fence boundaries splitting across chunks are the risk.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/meal-plan/RecipeBrowserScreen.tsx`
  - `client/hooks/useCoachStream.ts`
  - `client/components/coach/coach-chat-utils.ts`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Incremental parsing bugs could corrupt displayed coach text — test chunk-boundary cases.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (L9, L10).

### 2026-09-24

- Implemented both L9 and L10 via TDD (failing tests written first, confirmed RED against
  pre-fix code, then implementation, confirmed GREEN):
  - L9: `RecipeBrowserScreen.tsx` now spreads `FLATLIST_DEFAULTS` (spread-first) on the
    search-results `AnimatedSectionList`. New test in
    `RecipeBrowserScreen.params.test.tsx` overrides `react-native`'s `SectionList` in-file
    (the shared jsdom mock drops unlisted props, so it can't otherwise observe the spread)
    to capture and assert the props.
  - L10: added `stripCoachBlocksFenceIncremental` + `FenceScanState` +
    `createFenceScanState` to `coach-chat-utils.ts` — tracks scan offsets across repeated
    calls on the growing accumulated buffer instead of re-scanning from index 0 every SSE
    event. Wired into `useCoachStream.ts`'s content branch, with the fence-scan state reset
    alongside `accumulatedRef` at all three reset sites (`startStream`, `abortStream`,
    `safety_override`). The `done` branch keeps the original whole-text `stripCoachBlocksFence`
    as a reconciliation pass. Exhaustive 1-char chunk-boundary equivalence tests added.
  - Reviewed by `code-reviewer` and `mobile-reviewer` — no findings from either.
  - Codified: `docs/solutions/performance-issues/accumulated-string-marker-scan-quadratic-2026-09-24.md`.
