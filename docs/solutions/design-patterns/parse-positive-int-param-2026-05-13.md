---
title: "parsePositiveIntParam for Express 5 route param parsing"
track: knowledge
category: design-patterns
tags: [api, express, route-params, helper, typescript]
module: server
applies_to: ["server/routes/**/*.ts"]
created: 2026-05-13
---

# parsePositiveIntParam for Express 5 route param parsing

## When this applies

Every route that reads a numeric `:id`, `:itemId`, `:logId`, etc. from `req.params`. Parses route parameters as positive integers without `as string` casts. Accepts Express 5's `string | string[]` param type and returns `number | null`, rejecting NaN, zero, and negative values.

## Why

Express 5 changed `req.params.*` from `string` to `string | string[]`. Every `as string` cast is a type lie that hides a potential runtime bug. This helper handles the union type correctly and rejects non-positive values in a single call, eliminating 35+ identical validation blocks across the codebase.

## Examples

```typescript
import { parsePositiveIntParam } from "./_helpers";
import { sendError } from "../lib/api-errors";

// Before (repeated in 15+ routes, 35+ call sites):
const id = parseInt(req.params.id as string, 10);
if (isNaN(id) || id <= 0) {
  return res.status(400).json({ error: "Invalid item ID" });
}

// After:
const id = parsePositiveIntParam(req.params.id);
if (!id) return sendError(res, 400, "Invalid item ID");
```

Implementation:

```typescript
// server/routes/_helpers.ts
export function parsePositiveIntParam(value: string | string[]): number | null {
  const str = Array.isArray(value) ? value[0] : value;
  if (!str) return null;
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return null;
  return num;
}
```

## Exceptions

- Query parameters → use `parseQueryInt` instead
- Params that can be zero or negative → parse manually
- String params like `:slug` or `:uuid` → no parsing needed (use `parseStringParam`)

Combine with `sendError` for the error response.

## Related Files

- `server/routes/_helpers.ts` — implementation
- 13 route files: `suggestions`, `weight`, `pantry`, `chat`, `menu`, `saved-items`, `medication`, `grocery`, `nutrition`, `micronutrients`, `meal-plan`, `recipes` — consumers

## See Also

- [parseQueryInt typed query parameter parsing](parse-query-int-typed-query-parameter-2026-05-13.md)
- [parseStringParam Express 5 string route param parsing](parse-string-param-2026-05-13.md)
- [sendError standardized error response helper](send-error-standardized-error-response-helper-2026-05-13.md)
