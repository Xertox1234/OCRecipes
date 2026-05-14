---
title: "parseStringParam for Express 5 string route param parsing"
track: knowledge
category: design-patterns
tags: [api, express, route-params, helper, typescript]
module: server
applies_to: ["server/routes/**/*.ts"]
created: 2026-05-13
---

# parseStringParam for Express 5 string route param parsing

## When this applies

Routes with string params like `:sessionId`, `:slug`, `:uuid`. Parses a string route parameter without `as string` casts. Handles Express 5's `string | string[]` param type, returning `string | undefined`.

## Why

Express 5 changed `req.params.*` from `string` to `string | string[]`. Every `as string` cast on a route param is a type lie. The helper picks the first value when the framework returned an array, and returns `undefined` for missing params, forcing the caller to handle that case explicitly.

## Examples

```typescript
import { parseStringParam } from "./_helpers";

// Before (unsafe):
const sessionId = req.params.sessionId as string;

// After (type-safe):
const sessionId = parseStringParam(req.params.sessionId);
if (!sessionId) return sendError(res, 400, "Session ID is required");
```

Implementation:

```typescript
// server/routes/_helpers.ts
export function parseStringParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
```

## Exceptions

- Numeric params like `:id` → use `parsePositiveIntParam`

## Enforcement

The `ocrecipes/no-as-string-req` ESLint rule flags `as string` casts on `req.params` in `server/routes/**/*.ts`.

## Related Files

- `server/routes/_helpers.ts` — implementation
- `server/routes/photos.ts` — consumer

## See Also

- [parsePositiveIntParam Express 5 route param parsing](parse-positive-int-param-2026-05-13.md)
- [parseQueryString typed string query parameter parsing](parse-query-string-2026-05-13.md)
- [sendError standardized error response helper](send-error-standardized-error-response-helper-2026-05-13.md)
