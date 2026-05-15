---
title: "Session ownership verification for in-memory stores"
track: knowledge
category: conventions
tags: [security, sessions, in-memory-store, idor, authorization]
module: server
applies_to: ["server/routes/**/*.ts", "server/services/**/*.ts"]
created: 2026-05-13
---

# Session ownership verification for in-memory stores

## Rule

For in-memory session stores, always include `userId` and verify ownership on every read. Session IDs are guessable surface area; ownership verification turns a guessed session ID into a 403.

## Examples

```typescript
interface AnalysisSession {
  userId: string; // Always include owner ID
  result: AnalysisResult;
  createdAt: Date;
}

const sessionStore = new Map<string, AnalysisSession>();

// When creating session:
const sessionId = crypto.randomUUID(); // Use cryptographic randomness
sessionStore.set(sessionId, {
  userId: req.userId!, // Store owner
  result,
  createdAt: new Date(),
});

// When accessing session:
const session = sessionStore.get(sessionId);
if (!session || session.userId !== req.userId!) {
  return res.status(403).json({ error: "Not authorized" });
}
```

## Why

Prevents users from accessing other users' sessions, even if they guess the session ID. `crypto.randomUUID()` makes guessing impractical, but ownership verification is the actual security control.

## See Also

- [Session timeout cleanup pattern](../design-patterns/session-timeout-cleanup-pattern-2026-05-13.md)
- [Bounded in-memory store pattern](../design-patterns/bounded-in-memory-store-pattern-2026-05-13.md)
