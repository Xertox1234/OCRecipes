---
title: Session timeout cleanup pattern
track: knowledge
category: design-patterns
module: server
tags: [security, sessions, memory-leak, in-memory-store, cleanup]
applies_to: [server/routes/**/*.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# Session timeout cleanup pattern

## When this applies

In-memory session stores that need bounded lifetime. Track timeout references and per-user counts to prevent memory leaks.

## Examples

```typescript
const sessionStore = new Map<string, AnalysisSession>();
const sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const userSessionCount = new Map<string, number>();

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Clear session, its timeout, and decrement user count.
 * Call this whenever a session is deleted to prevent memory leaks.
 */
function clearSession(sessionId: string): void {
  const session = sessionStore.get(sessionId);
  const existingTimeout = sessionTimeouts.get(sessionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    sessionTimeouts.delete(sessionId);
  }
  sessionStore.delete(sessionId);
  if (session) {
    decrementUserCount(session.userId);
  }
}

// When creating session:
const timeoutId = setTimeout(() => {
  clearSession(sessionId); // Always use clearSession — never delete manually
}, SESSION_TIMEOUT);
sessionTimeouts.set(sessionId, timeoutId);

// When session is accessed/confirmed:
clearSession(sessionId);
```

## Why

Orphaned timeouts consume memory and may reference stale data. Always route deletion through `clearSession()` so per-user counts stay consistent.

## See Also

- [Session ownership verification](../conventions/session-ownership-verification-2026-05-13.md)
- [Bounded in-memory store pattern](bounded-in-memory-store-pattern-2026-05-13.md)
- [Test internals export pattern](test-internals-export-pattern-2026-05-13.md)
