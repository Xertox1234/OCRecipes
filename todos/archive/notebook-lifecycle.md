---
title: "Notebook lifecycle — bounded queries + archival"
status: in-progress
priority: high
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [performance, data-integrity, coach-pro, audit-2026-04-12]
---

# Notebook Lifecycle Management

## Summary

Add LIMIT to `getActiveNotebookEntries` and wire up `archiveOldEntries` to prevent unbounded notebook growth. Fixes H1 from the 2026-04-12 audit.

## Background

Each Coach Pro conversation appends up to 10 notebook entries. `getActiveNotebookEntries` has no LIMIT clause, and `archiveOldEntries` exists but is never called from any route/service/cron. Over time, a frequent user could accumulate thousands of active entries, all fetched on every context load and message send.

The system prompt truncates at `MAX_NOTEBOOK_CHARS = 3200`, but the full rows are still fetched from DB and deserialized.

## Acceptance Criteria

- [ ] `getActiveNotebookEntries` has a LIMIT clause (suggest 100 — enough for context, bounded for performance)
- [ ] `archiveOldEntries` is called automatically (either in the chat message handler after notebook extraction, or on a periodic basis)
- [ ] Consider adding `(userId, type, status, followUpDate)` compound index (L7) for optimal commitment query
- [ ] Tests updated to verify bounded query behavior

## Implementation Notes

- Simplest approach: call `archiveOldEntries(userId, 30)` fire-and-forget after each notebook extraction in `chat.ts`.
- The LIMIT should be on the query itself, not just JS truncation.
- The 3200-char budget in the system prompt is a separate concern — keep that as defense-in-depth.

## Updates

### 2026-04-12

- Created from audit finding H1 (also covers L7 suboptimal index)
