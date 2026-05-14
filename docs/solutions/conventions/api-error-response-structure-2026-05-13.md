---
title: "API error response structure"
track: knowledge
category: conventions
tags: [api, errors, response-shape, http]
module: server
applies_to: ["server/routes/**/*.ts", "server/lib/api-errors.ts"]
created: 2026-05-13
---

# API error response structure

## Rule

All API errors must follow a single response shape:

```typescript
interface ApiError {
  error: string; // Human-readable message
  code?: string; // Machine-readable code for client logic
  details?: Record<string, string>; // Field-specific errors (validation)
}
```

## Why

Before this convention, 23 route files each constructed error JSON inline with subtly different shapes — some used `{ message }`, some `{ error }`, some included `code`, some did not. A single shape eliminates client-side branching on response shape and makes adding cross-cutting fields (e.g. `requestId`) a one-place change.

## Examples

Canonical error codes the client expects:

- `TOKEN_EXPIRED` — JWT token has expired
- `TOKEN_INVALID` — JWT token is malformed or invalid
- `NO_TOKEN` — No authentication token provided
- `VALIDATION_ERROR` — Request body validation failed
- `NOT_FOUND` — Resource not found
- `CONFLICT` — Resource already exists (e.g., duplicate username)
- `LIMIT_REACHED` — User has reached a resource limit (e.g., max saved items)
- `PREMIUM_REQUIRED` — Feature requires a premium subscription
- `DAILY_LIMIT_REACHED` — User has exhausted a daily usage quota
- `DATE_RANGE_LIMIT` — Requested date range exceeds tier allowance
- `LIST_LIMIT_REACHED` — Per-user resource count ceiling hit (e.g., max grocery lists)

Use the `sendError()` helper rather than constructing this shape inline.

## Related Files

- `server/lib/api-errors.ts` — `sendError()` implementation
- `shared/constants/error-codes.ts` — `ErrorCode` constants

## See Also

- [sendError standardized error response helper](../design-patterns/send-error-standardized-error-response-helper-2026-05-13.md)
- [ErrorCode constants for machine-readable error codes](error-code-constants-machine-readable-2026-05-13.md)
- [handleRouteError centralized route error handler](../design-patterns/handle-route-error-centralized-handler-2026-05-13.md)
