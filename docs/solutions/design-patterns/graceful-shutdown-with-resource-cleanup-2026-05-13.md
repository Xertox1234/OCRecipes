---
title: Graceful shutdown with resource cleanup (SIGTERM/SIGINT)
track: knowledge
category: design-patterns
module: server
tags: [api, shutdown, signals, lifecycle, node]
applies_to: [server/index.ts]
created: '2026-05-13'
---

# Graceful shutdown with resource cleanup (SIGTERM/SIGINT)

## When this applies

Every production Express server. Without graceful shutdown, `SIGTERM` from Docker / Kubernetes kills in-flight requests and can corrupt database state. Register `SIGTERM` and `SIGINT` handlers that stop accepting new connections, clear periodic jobs, and close the database pool. Add a forced-exit timeout to prevent hangs.

## Examples

```typescript
// Start periodic jobs
const cacheCleanupInterval = startCacheCleanupJob();

// Graceful shutdown
function shutdown(signal: string) {
  log(`${signal} received, shutting down gracefully`);
  clearInterval(cacheCleanupInterval); // 1. Stop periodic jobs
  server.close(() => {
    // 2. Stop accepting new connections, finish in-flight
    pool.end().then(() => {
      // 3. Close DB pool after all requests drain
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10_000); // 4. Force exit if stuck
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

## Shutdown order matters

1. **Clear intervals** — prevent new background work from starting
2. **`server.close()`** — stops accepting new TCP connections, waits for in-flight requests to complete
3. **`pool.end()`** — releases all database connections (must be after server.close so in-flight queries finish)
4. **Forced exit** — 10-second safety net for stuck connections (e.g., long-polling, WebSocket keepalive)

## Related Files

- `server/index.ts` — shutdown handler with cache cleanup + pool.end

## See Also

- [Process-level uncaughtException and unhandledRejection handlers](../conventions/process-level-error-handlers-2026-05-13.md)
