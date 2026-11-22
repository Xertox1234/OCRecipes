---
title: "Timed Undo and banners: meet WCAG 2.2.1 (Timing Adjustable)"
status: backlog
priority: medium
created: 2026-11-21
updated: 2026-11-22
assignee:
labels: [deferred, accessibility, client]
github_issue:
---

# Timed Undo and banners: meet WCAG 2.2.1 (Timing Adjustable)

## Summary

Accessibility audit 2026-11-21 finding, deferred at triage by the owner (or a part of a fixed finding that needs a design call). Source: `docs/audits/2026-11-21-accessibility.md` (local manifest).

## Background

`client/components/OfflineBanner.tsx` (~:54-70) auto-hides after 4 s; `client/components/coach/SavedToNotebookPopup.tsx` (:210, 238-245) and `client/components/coach/blocks/write-cards/WriteCardShell.tsx:302` (UNDO_VISIBLE_MS 6000) remove Undo after 6 s. The docs check found that extending only while a screen reader is on does not satisfy 2.2.1 (Level A): the options are turning the limit off, 10x adjustable, or warn-and-extend. The popup's announce can also cut off the reply's finish announce on iOS.

## Acceptance Criteria

- [ ] Write-card Undo (WriteCardShell / UNDO_VISIBLE_MS) stays until the user sends the next message or leaves the screen
- [ ] The SavedToNotebook popup keeps Undo until the next action instead of auto-confirming after 6 s
- [ ] OfflineBanner stays until dismissed or the connection returns
- [ ] The SavedToNotebook announce no longer cuts off the reply announce on iOS
- [ ] Tests cover each (no auto-hide; hide on the next action)

## Implementation Notes

Doc evidence: WCAG 2.2 SC 2.2.1; RN AccessibilityInfo.getRecommendedTimeoutMillis. Files as listed.

## Updates

### 2026-11-21

- Filed from the accessibility audit

### 2026-11-22

- Owner decision: no timers — Undo stays visible until the next action (the next message sent, or leaving the screen); the offline banner stays until dismissed or back online.
