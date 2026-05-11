---
title: "coach-pro-chat.ts: replace bare logger with createServiceLogger"
status: backlog
priority: low
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [code-quality, architecture]
github_issue:
---

# coach-pro-chat.ts: replace bare logger with createServiceLogger

## Summary

`server/services/coach-pro-chat.ts` imports the bare `logger` singleton (the route pattern) instead of using `createServiceLogger("coach-pro-chat")` (the services pattern). This loses the per-service name label in structured log output.

## Background

Audit 2026-05-10, finding M5. File: `server/services/coach-pro-chat.ts:34`. Pre-existing violation not caught in prior audits.

## Acceptance Criteria

- [ ] `import { logger }` replaced with `import { createServiceLogger } from "../lib/logger"`
- [ ] `const log = createServiceLogger("coach-pro-chat")` added at module scope
- [ ] All `logger.*` calls in the file replaced with `log.*`
- [ ] Type check passes

## Updates

### 2026-05-10
- Deferred from audit 2026-05-10 (M5) — cosmetic logging improvement
