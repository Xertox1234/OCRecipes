---
title: sendError standardized error response helper
track: knowledge
category: design-patterns
module: server
tags: [api, errors, helper, response-shape]
applies_to: [server/routes/**/*.ts, server/lib/api-errors.ts]
created: '2026-05-13'
---

# sendError standardized error response helper

## When this applies

Every error response in every route handler. No route should construct `res.status(N).json({ error: "..." })` manually.

## Why

Before this helper, 23 route files each constructed error JSON inline with subtly different shapes — some used `{ message }`, some `{ error }`, some included `code`, some did not. A single function eliminates drift and makes it easy to add fields (e.g., `requestId`) to all errors in one place.

## Examples

```typescript
import { sendError } from "../lib/api-errors";

// Simple error — no machine-readable code
sendError(res, 404, "Item not found");

// Error with code — client can match on `code` for branching logic
sendError(res, 403, "Premium required", "PREMIUM_REQUIRED");
sendError(res, 429, "Daily limit reached", "DAILY_LIMIT_REACHED");
```

Implementation:

```typescript
// server/lib/api-errors.ts
export function sendError(
  res: Response,
  status: number,
  error: string,
  code?: string,
): void {
  const body: Record<string, unknown> = { error };
  if (code) body.code = code;
  res.status(status).json(body);
}
```

## Exceptions

- Success responses (`res.json(data)`)
- SSE streams (which use `res.write()`)

## Related Files

- `server/lib/api-errors.ts` — implementation
- All route files under `server/routes/` — consumers

## See Also

- [API error response structure](../conventions/api-error-response-structure-2026-05-13.md)
- [ErrorCode constants for machine-readable error codes](../conventions/error-code-constants-machine-readable-2026-05-13.md)
- [handleRouteError centralized route error handler](handle-route-error-centralized-handler-2026-05-13.md)
