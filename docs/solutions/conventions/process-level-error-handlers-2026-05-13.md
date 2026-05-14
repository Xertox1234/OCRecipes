---
title: "Process-level uncaughtException and unhandledRejection handlers"
track: knowledge
category: conventions
tags: [api, process, error-handling, observability, node]
module: server
applies_to: ["server/index.ts"]
created: 2026-05-13
---

# Process-level uncaughtException and unhandledRejection handlers

## Rule

Register `uncaughtException` and `unhandledRejection` handlers at the top of `server/index.ts` (after imports, before app setup) to catch fatal errors that bypass Express middleware.

## Why

These catch errors from outside Express: database connection drops, timer callbacks, event emitter errors, `setTimeout` throws. Without them, crashes produce no log output. Every production Node.js server needs them as a baseline for observability.

## Examples

```typescript
process.on("uncaughtException", (error) => {
  logger.fatal({ err: toError(error) }, "uncaught exception");
  rootLogger.flush();
  setTimeout(() => process.exit(1), 500);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: toError(reason) }, "unhandled rejection");
});
```

## Key details

- `uncaughtException` MUST exit — after an uncaught exception the process is in an undefined state. Call `rootLogger.flush()` then `setTimeout(() => process.exit(1), 500)` to give async transports time to drain
- `unhandledRejection` logs but does NOT exit — these are often recoverable (e.g., a forgotten `.catch()` on a fire-and-forget promise)
- No restart logic in the handlers — that's the process manager's job

## Related Files

- `server/index.ts` — lines 18-30

## See Also

- [Graceful shutdown with resource cleanup](../design-patterns/graceful-shutdown-with-resource-cleanup-2026-05-13.md)
