---
title: "Add client disconnect handling to SSE chat endpoint"
status: pending
priority: p1
created: 2026-02-25
updated: 2026-02-25
assignee:
labels: [code-review, performance, security, chat]
---

# Add client disconnect handling to SSE chat endpoint

## Summary

The SSE streaming endpoint at `POST /api/chat/conversations/:id/messages` continues consuming OpenAI tokens after the client disconnects. This wastes API credits and server resources.

## Background

Found by: security-sentinel (L2), performance-oracle (CRITICAL-2)

When a client disconnects mid-stream (navigates away, kills app, network drop), the `for await` loop continues generating tokens from OpenAI until the full response is complete. There is no `req.on('close')` handler. An attacker could open many SSE connections and immediately abort them, generating parallel OpenAI requests that all run to completion.

**File:** `server/routes/chat.ts`, lines 159-196

## Acceptance Criteria

- [ ] `req.on('close')` handler sets an abort flag
- [ ] Streaming loop checks abort flag and breaks early
- [ ] Partial responses are saved to maintain conversation consistency
- [ ] Ideally, AbortSignal passed to OpenAI streaming call to cancel upstream

## Implementation Notes

```typescript
let aborted = false;
req.on('close', () => { aborted = true; });

for await (const chunk of generateCoachResponse(messageHistory, context)) {
  if (aborted) {
    if (fullResponse.length > 0) {
      await storage.createChatMessage(id, "assistant", fullResponse);
    }
    break;
  }
  fullResponse += chunk;
  res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
}
```

## Updates

### 2026-02-25
- Created from code review (7-agent parallel review)
