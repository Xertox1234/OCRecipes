---
title: "Add try/catch to all chat.ts route handlers"
status: pending
priority: p1
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, bug, chat, error-handling]
---

# Add try/catch to all chat.ts route handlers

## Summary

5 of 5 route handlers in `server/routes/chat.ts` lack try/catch blocks, which will cause unhandled crashes in production if any storage call throws.

## Background

Found by: pattern-recognition-specialist (E3)

Every other route file in the codebase wraps handlers in try/catch with `sendError(res, 500, ...)` for unexpected failures. The chat routes are the only exception. If `storage.getChatConversations()` or any DB call throws, Express will send a generic 500 HTML error instead of a JSON error response.

**File:** `server/routes/chat.ts` — all 5 handlers

## Acceptance Criteria

- [ ] All 5 handlers wrapped in try/catch
- [ ] Catch blocks use `sendError(res, 500, "Failed to ...")` pattern
- [ ] Catch blocks log `console.error("Chat error:", error)` before sendError
- [ ] SSE streaming handler's existing catch block also logs the error (currently empty catch)

## Implementation Notes

The SSE handler (POST messages) already has a partial try/catch for the streaming portion, but the preamble (validation, conversation lookup, message count check) is unprotected. Wrap the entire handler.

Also fix the empty catch on line 191 to log the error:
```typescript
} catch (error) {
  console.error("Coach response generation failed:", error);
  res.write(`data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`);
}
```

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
