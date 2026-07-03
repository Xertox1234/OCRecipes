---
title: Bounded in-memory store pattern (per-user + global caps)
track: knowledge
category: design-patterns
module: server
tags: [security, memory-exhaustion, in-memory-store, dos, validation]
applies_to: [server/routes/**/*.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# Bounded in-memory store pattern (per-user + global caps)

## When this applies

When holding per-user state in a `Map`, enforce per-user caps, a global cap, and size validation to prevent memory exhaustion attacks.

## Examples

```typescript
const MAX_SESSIONS_PER_USER = 3;
const MAX_SESSIONS_GLOBAL = 1000;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// Check raw buffer size — NOT base64 string length (which is ~33% larger)
if (req.file.buffer.length > MAX_IMAGE_SIZE_BYTES) {
  return sendError(res, 413, "Image too large", "IMAGE_TOO_LARGE");
}
if (sessionStore.size >= MAX_SESSIONS_GLOBAL) {
  return sendError(res, 429, "Server busy", "SESSION_LIMIT_REACHED");
}
if ((userSessionCount.get(userId) ?? 0) >= MAX_SESSIONS_PER_USER) {
  return sendError(res, 429, "Too many sessions", "USER_SESSION_LIMIT");
}
```

## Why

An unbounded `Map` holding base64 images (~1-4 MB each) can exhaust server memory. Always cap per-user and global counts, and validate payload size before storing. Check raw buffer size (`req.file.buffer.length`), not the base64 string length — the encoded string is ~33% larger.

## See Also

- [Session timeout cleanup pattern](session-timeout-cleanup-pattern-2026-05-13.md)
- [Early rejection before paid APIs](early-rejection-before-paid-apis-2026-05-13.md)
- [Session ownership verification](../conventions/session-ownership-verification-2026-05-13.md)
