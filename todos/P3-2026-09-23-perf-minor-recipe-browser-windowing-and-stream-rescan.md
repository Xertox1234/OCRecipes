---
title: "RecipeBrowser section list has no windowing props, and useCoachStream re-scans the whole accumulated response on each SSE event"
status: backlog
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
