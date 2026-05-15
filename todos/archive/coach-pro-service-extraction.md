---
title: "Coach Pro service extraction — cross-route import, parallel tools, handler decomposition"
status: backlog
priority: high
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [architecture, coach-pro, audit-2026-04-12]
---

# Coach Pro Service Extraction

## Summary

Extract Coach Pro orchestration from `chat.ts` route handler into a dedicated service. Fixes cross-route import (H2), sequential tool calls (M3), and oversized handler (M11) from the 2026-04-12 audit.

## Background

The `POST /api/chat/conversations/:id/messages` handler is ~470 lines orchestrating 3+ storage domains, 3 code paths, SSE lifecycle, caching, and notebook extraction. The warm-up cache (`consumeWarmUp`) lives in `coach-context.ts` as in-memory state, requiring a cross-route import into `chat.ts` — violating the architecture pattern that routes are independent modules.

## Acceptance Criteria

- [ ] **H2**: `consumeWarmUp` and warm-up cache moved from `server/routes/coach-context.ts` to `server/services/coach-warm-up.ts` (or `server/storage/sessions.ts`)
- [ ] **H2**: `chat.ts` imports from service/storage, not from another route
- [ ] **M3**: `executeToolCall` invocations in `nutrition-coach.ts:306-327` run via `Promise.allSettled` instead of sequential `for...of`
- [ ] **M11**: Coach Pro path (~200 lines) extracted from `chat.ts` handler into a service function
- [ ] No cross-route imports remain in `server/routes/`
- [ ] All existing tests pass

## Implementation Notes

- Warm-up cache is an in-memory `Map` with a `setInterval` sweep. This is stateful logic that belongs in a service or storage module.
- Tool calls are independent (lookup_nutrition, search_recipes, get_daily_log, get_pantry). `Promise.allSettled` handles individual failures gracefully.
- The extracted service should handle: context building, notebook injection, streaming delegation, notebook extraction.

## Dependencies

- None — this is a refactor with no API changes.

## Updates

### 2026-04-12

- Created from audit findings H2, M3, M11
