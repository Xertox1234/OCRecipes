---
title: ErrorCode constants for machine-readable error codes
track: knowledge
category: conventions
module: server
tags: [api, errors, constants, response-shape]
applies_to: [server/routes/**/*.ts, shared/constants/error-codes.ts]
created: '2026-05-13'
---

# ErrorCode constants for machine-readable error codes

## Rule

All `sendError()` calls must pass an `ErrorCode` constant from `@shared/constants/error-codes.ts` instead of an ad-hoc string literal. This ensures a stable, searchable set of error codes that clients can match on.

## Why

Ad-hoc string literals drift in spelling (`"DAILY_LIMIT"` vs `"DAILY_LIMIT_REACHED"`) and aren't grep-able as a set when auditing what error codes the API can produce. Centralizing in a constants file gives the client a single import for case statements.

## Examples

```typescript
import { ErrorCode } from "@shared/constants/error-codes";

// Good: constant from shared file
sendError(res, 404, "Item not found", ErrorCode.NOT_FOUND);
sendError(res, 429, "Daily limit reached", ErrorCode.DAILY_LIMIT_REACHED);
sendError(res, 409, "Username already taken", ErrorCode.CONFLICT);

// Bad: ad-hoc string literals
sendError(res, 404, "Item not found", "ITEM_NOT_FOUND"); // not in ErrorCode
sendError(res, 429, "Daily limit reached", "DAILY_LIMIT"); // inconsistent spelling
```

## Adding a new code

Add it to `shared/constants/error-codes.ts` first, then use `ErrorCode.NEW_CODE` at the call site. Never introduce a string literal that belongs in the constant.

## Exceptions

Highly domain-specific codes that will never be used elsewhere (e.g., `CATALOG_QUOTA_EXCEEDED`) may remain as string literals directly in `sendError()`, but these are the exception, not the rule.

## Related Files

- `shared/constants/error-codes.ts` — the constant definition + `ErrorCode` type
- All route files under `server/routes/` — consumers

## See Also

- [API error response structure](api-error-response-structure-2026-05-13.md)
- [sendError standardized error response helper](../design-patterns/send-error-standardized-error-response-helper-2026-05-13.md)
- [handleRouteError centralized route error handler](../design-patterns/handle-route-error-centralized-handler-2026-05-13.md)
