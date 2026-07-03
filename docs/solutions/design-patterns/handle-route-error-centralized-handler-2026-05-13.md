---
title: handleRouteError centralized route error handler
track: knowledge
category: design-patterns
module: server
tags: [api, errors, helper, zod, logging]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# handleRouteError centralized route error handler

## When this applies

Every `catch` block in every route handler. No route should contain inline `ZodError` branching. The helper maps `ZodError` → 400 and anything else → 500 with structured logging.

## Why

This is a binding rule from `docs/rules/api.md` — "All catch blocks must use `handleRouteError(res, error)` — never custom `res.status(500).json(...)` responses." Inline `ZodError` checks drift across 13+ route files (different error shapes, missing structured logs, inconsistent context labels). The helper provides a uniform catch block and centralizes the logging format.

## Examples

```typescript
import { handleRouteError } from "./_helpers";

// Good: uniform catch with context label
app.post("/api/items", requireAuth, async (req, res) => {
  try {
    const parsed = ItemSchema.parse(req.body);
    const item = await storage.createItem(req.userId!, parsed);
    res.status(201).json(item);
  } catch (err) {
    handleRouteError(res, err, "create item");
  }
});

// Bad: manual ZodError check duplicated in every catch block
} catch (err) {
  if (err instanceof ZodError) {
    sendError(res, 400, formatZodError(err), "VALIDATION_ERROR");
    return;
  }
  logger.error({ err }, "create item error");
  sendError(res, 500, "Failed to create item", "INTERNAL_ERROR");
}
```

Implementation:

```typescript
// server/routes/_helpers.ts
export function handleRouteError(
  res: Response,
  error: unknown,
  context: string,
): void {
  if (error instanceof ZodError) {
    sendError(res, 400, formatZodError(error), ErrorCode.VALIDATION_ERROR);
    return;
  }
  logger.error({ err: toError(error) }, `${context} error`);
  sendError(res, 500, `Failed to ${context}`, ErrorCode.INTERNAL_ERROR);
}
```

## Context label

Pass a lowercase verb phrase: `"create item"`, `"fetch daily log"`, `"update profile"`. It appears in both the logged error and the 500 response body.

## Exceptions

Handlers that need to catch specific domain errors (e.g., a 409 for a known conflict) should handle those cases before calling `handleRouteError`, or use a custom catch block.

## Related Files

- `server/routes/_helpers.ts` — implementation
- All 13 route files that replaced inline `ZodError` catch blocks with `handleRouteError`
- `docs/rules/api.md` — binding rule one-liner

## See Also

- [sendError standardized error response helper](send-error-standardized-error-response-helper-2026-05-13.md)
- [ErrorCode constants for machine-readable error codes](../conventions/error-code-constants-machine-readable-2026-05-13.md)
- [Generic error messages for 5xx responses](../conventions/generic-error-messages-5xx-2026-05-13.md)
