---
title: "nutrition-coach: add Zod safeParse to tool call argument parsing"
status: backlog
priority: low
created: 2026-05-10
updated: 2026-05-10
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

- [ ] Each `tc.function.arguments` parse in `server/services/nutrition-coach.ts` wrapped in `try { JSON.parse(...) } catch { log SyntaxError, return serviceUnavailable tuple }` before passing to `executeToolCall`
- [ ] OR: move the `JSON.parse` inside the existing per-tool `try-catch` inside `executeToolCall` in `server/services/coach-tools.ts` for a single place of responsibility
- [ ] Type check passes

## Implementation Notes

Files in scope:

- server/services/nutrition-coach.ts
- server/services/coach-tools.ts
- server/services/**tests**/coach-tools.test.ts

## Updates

### 2026-05-10

- Deferred from audit 2026-05-10 (M15) — low risk; outer catch already handles SyntaxError
