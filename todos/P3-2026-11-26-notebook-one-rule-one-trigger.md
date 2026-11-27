---
title: "Coach notebook: one speakable-entry rule, one archival trigger, NotebookEntryScreen's repeated status flow"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, architecture, maintainability]
github_issue:
---

# Coach notebook: one rule, one trigger

## Summary

The notebook's rule for what the Coach may say aloud is written in four places. Its archival runs from two call sites with two throttle keys. Deferred from the coach chat audit 2026-11-24, bundle K (owner 2026-11-26: small fixes now, refactors later).

## Background

Audit rows, in `docs/audits/2026-11-24-coach-chat.md`:

- **L126:** the "speakable notebook entry" rule (active, confirmed, type in goal, preference or commitment) is re-implemented in four places, starting from the `SPEAKABLE_NOTEBOOK_TYPES` tuple in storage.
- **L127:** `archiveOldEntries` is behind a per-user in-memory throttle. It is called from two places (`tryArchiveNotebook` in `coach-pro-chat.ts`, from the GET messages route, and one more) with two keys.
- **L123:** `client/screens/NotebookEntryScreen.tsx` (760 lines) has the same 28-line status flow twice (`handleMarkComplete`, `handleArchive`) and repeats its date conversion.

## Acceptance Criteria

- [ ] One exported predicate (or SQL fragment) defines a speakable entry, and all four sites use it.
- [ ] Archival has one entry point and one throttle key.
- [ ] NotebookEntryScreen's two status handlers share one helper. Its date conversion is one function.
- [ ] Existing notebook storage, route and screen tests pass. One test pins each shared rule.

## Implementation Notes

- Files: `server/storage/coach-notebook.ts`, `server/storage/coach-notebook-memory.ts`, `server/services/coach-pro-chat.ts`, `server/routes/chat.ts`, `client/screens/NotebookEntryScreen.tsx`.
