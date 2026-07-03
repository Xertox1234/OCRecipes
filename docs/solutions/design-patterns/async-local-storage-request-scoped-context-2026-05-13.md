---
title: AsyncLocalStorage for request-scoped context
track: knowledge
category: design-patterns
module: server
tags: [api, async-local-storage, request-context, logging, observability]
applies_to: [server/lib/**/*.ts, server/middleware/**/*.ts]
created: '2026-05-13'
---

# AsyncLocalStorage for request-scoped context

## When this applies

Request ID propagation, user context in services, audit trails, distributed tracing headers — anywhere you need per-request state without threading it through every function call.

## Why

Without ALS, every helper that wants to log `requestId` or `userId` needs those values passed as arguments. ALS makes them ambient: any code in the request's async call chain can read them via `getRequestContext()`. This is how pino's `mixin` callback can inject `requestId` into every log line without the caller knowing about logging.

## Examples

```typescript
// server/lib/request-context.ts
const als = new AsyncLocalStorage<RequestContext>();

// Middleware creates the store
export function requestContextMiddleware(req, res, next) {
  const requestId = req.id; // from pino-http
  res.setHeader("X-Request-Id", requestId);
  als.run({ requestId, userId: null }, () => next());
}

// Any code can read it — no parameter threading needed
export function getRequestContext() {
  return als.getStore(); // undefined outside a request
}
```

## Key details

- ALS context propagates through `Promise` chains, `setTimeout`, and `process.nextTick` in Node 18+
- Returns `undefined` outside a request (startup, shutdown, background jobs) — callers must handle this gracefully
- The store object is mutable — `setRequestUserId()` updates it in-place after auth middleware runs, which is safe because Node.js is single-threaded (one request never shares a store with another)
- When middleware B needs data that middleware A produced, B should **read A's output** (e.g., `req.id`) rather than re-derive from the same source (e.g., re-parsing `X-Request-Id`). This prevents divergence bugs.

## Exceptions

Short-lived scripts, single-function handlers where passing a parameter is simpler than setting up ALS.

## Related Files

- `server/lib/request-context.ts` — ALS store, middleware, `getRequestContext()`, `setRequestUserId()`
- `server/lib/logger.ts` — pino `mixin` reads ALS to inject `requestId`/`userId` into every log call
- `server/middleware/auth.ts` — calls `setRequestUserId()` after token verification
