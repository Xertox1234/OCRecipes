---
title: "Verification route re-implements the history-nutrition parse without the null guard"
status: done
priority: low
created: 2026-11-05
updated: 2026-11-05
assignee: claude
labels: [audit, code-quality, server]
github_issue:
---

# Verification route re-implements the history-nutrition parse without the null guard

## Summary

CQ8: `server/routes/verification.ts` `mapHistoryEntry` casts `extractedNutrition` to a record and reads fields — a null blob throws a TypeError and 500s the submit. `server/storage/verification.ts` `parseHistoryNutrition` already does the same normalisation null-safely ("Mirrors the route's parsing").

## Acceptance Criteria

- [x] One parser, null-safe, used by both route and storage
- [x] Test: a history entry with `extractedNutrition: null` no longer throws

## Scope Contract

- **Files in scope:** `server/routes/verification.ts`, `server/storage/verification.ts`, their tests
