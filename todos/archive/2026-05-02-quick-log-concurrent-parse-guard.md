---
title: "Guard handleTextSubmit against concurrent voice+manual parse race"
status: in-progress
priority: low
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, data-integrity]
---

# Guard handleTextSubmit against concurrent voice+manual parse race

## Summary

`handleTextSubmit` calls `parseFoodTextMutate` unconditionally with no `isParsing` guard. If voice auto-parse fires concurrently (isFinal + Return key), two in-flight parses race — the last `onSuccess` silently overwrites the first set of parsed items.

## Background

Deferred from 2026-05-02 full audit (finding L4). `client/hooks/useQuickLogSession.ts` lines 76-90. The `isFinal` effect (line 59-73) also calls `parseFoodTextMutate` without checking `isParsing`. Adding an `if (isParsing) return;` guard to `handleTextSubmit` prevents the race.

## Acceptance Criteria

- [ ] `handleTextSubmit` returns early if `isParsing` is true
- [ ] The `isFinal` auto-parse effect already has `!isParsing` guard (line 60) — confirm this is sufficient

## Implementation Notes

One-liner: `if (!inputText.trim() || isParsing) return;` at the top of `handleTextSubmit`.

## Dependencies

- None

## Risks

- None — purely additive guard

## Updates

### 2026-05-02

- Initial creation (deferred from audit L4)
