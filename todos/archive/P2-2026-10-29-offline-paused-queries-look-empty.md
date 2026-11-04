---
title: "Show an offline state for paused queries instead of an empty list or "not found""
status: done
priority: medium
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, client, reliability]
github_issue:
---

# Show an offline state for paused queries instead of an empty list or "not found"

## Summary

With TanStack's default networkMode, an offline cold start with no cached data leaves a query paused — not loading, not errored, no data — and every screen renders it as genuinely empty.

## Background

Audit finding M-crel-5. Nothing under `client/` reads `fetchStatus` or `isPaused`. Worst case: a coach-reminder notification tapped offline opens `NotebookEntryScreen`, which says "This entry couldn't be found. It may have been deleted." (~90-96, ~263). The overnight run fixed the failed-fetch (isError) case on Notebook, All Conversations and Chat (commit 8904f841) but not the paused case.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] A shared helper (or `EmptyState` variant) renders an offline/paused state when `fetchStatus === "paused"` and there is no data
- [ ] NotebookEntryScreen's not-found branch excludes the paused state
- [ ] Notebook, All Conversations and Chat use the helper; other screens listed in Implementation Notes are checked
- [ ] Tests assert the paused state renders for at least NotebookEntryScreen and one list screen

## Implementation Notes

Search `client/screens` for `data: x = []` defaults without an isError/fetchStatus check. Device check needed: airplane-mode cold start.

## Scope Contract

- **Files in scope:** `client/components/EmptyState.tsx` (or a new small helper beside it), `client/screens/NotebookEntryScreen.tsx`, `client/screens/NotebookScreen.tsx`, `client/screens/AllConversationsScreen.tsx`, `client/screens/ChatScreen.tsx` and their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
