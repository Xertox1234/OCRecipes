---
title: "nutrition-coach: add Zod safeParse to tool call argument parsing"
status: done
priority: low
created: 2026-05-10
updated: 2026-05-15
assignee:
labels: [code-quality, ai]
github_issue:
---

# nutrition-coach: add Zod safeParse to tool call argument parsing

## Summary

`JSON.parse(tc.function.arguments)` in the tool-call loop has no Zod `safeParse` at the parse site. The per-tool schemas exist inside `executeToolCall`, so failures are caught, but a `SyntaxError` from malformed JSON (e.g. truncated due to `finish_reason: "length"`) is only caught incidentally by the outer `try-catch`.

## Background

Audit 2026-05-10, finding M15. File: `server/services/nutrition-coach.ts:529`.

## Acceptance Criteria

- [x] Each `tc.function.arguments` parse in `server/services/nutrition-coach.ts` wrapped in `try { JSON.parse(...) } catch { log SyntaxError, return serviceUnavailable tuple }` before passing to `executeToolCall`
- [x] OR: move the `JSON.parse` inside the existing per-tool `try-catch` inside `executeToolCall` in `server/services/coach-tools.ts` for a single place of responsibility
- [x] Type check passes

## Implementation Notes

Files in scope:

- server/services/nutrition-coach.ts
- server/services/coach-tools.ts
- server/services/**tests**/coach-tools.test.ts

## Updates

### 2026-05-10

- Deferred from audit 2026-05-10 (M15) — low risk; outer catch already handles SyntaxError

### 2026-05-15

- Already resolved by PR #129 (commit `06cf7bd5`). All acceptance criteria satisfied: explicit `JSON.parse` try/catch + plain-object shape guard added at `server/services/nutrition-coach.ts:543-580`, with unit tests at `server/services/__tests__/nutrition-coach.test.ts:287` (malformed JSON) and `:327` (non-object args). Archiving stale todo.
