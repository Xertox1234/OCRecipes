---
title: parseQueryInt for typed query parameter parsing
track: knowledge
category: design-patterns
module: server
tags: [api, express, query-params, helper, typescript]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# parseQueryInt for typed query parameter parsing

## When this applies

Any route that reads `limit`, `offset`, `page`, `days`, or other numeric query parameters. Replaces boilerplate `Math.min(parseInt(req.query.limit as string) || default, max)` with a single call that handles Express 5's `unknown` query types, NaN fallback, and min/max clamping.

## Why

Express 5 types `req.query.*` as `unknown`, forcing every handler to cast and validate. This helper encapsulates the cast, NaN fallback, and clamping in one place. The `max` option prevents clients from requesting unbounded result sets that could overload the database.

## Examples

```typescript
import { parseQueryInt } from "./_helpers";

// Before (repeated in 12+ routes):
const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
const offset = parseInt(req.query.offset as string) || 0;

// After:
const limit = parseQueryInt(req.query.limit, { default: 50, max: 100 });
const offset = parseQueryInt(req.query.offset, { default: 0, min: 0 });
```

Implementation:

```typescript
// server/routes/_helpers.ts
export function parseQueryInt(
  value: unknown,
  options: { default: number; min?: number; max?: number },
): number {
  const num = typeof value === "string" ? parseInt(value, 10) : NaN;
  let result = isNaN(num) ? options.default : num;
  if (options.min !== undefined) result = Math.max(result, options.min);
  if (options.max !== undefined) result = Math.min(result, options.max);
  return result;
}
```

## Exceptions

- Route params → use `parsePositiveIntParam` instead
- Query params that are not integers (parse manually)

Always pair with explicit `max` to prevent unbounded queries (e.g., `?limit=999999`).

## Related Files

- `server/routes/_helpers.ts` — implementation
- 11 route files: `adaptive-goals`, `fasting`, `weight`, `pantry`, `chat`, `menu`, `saved-items`, `medication`, `grocery`, `nutrition` — consumers

## See Also

- [parsePositiveIntParam Express 5 route param parsing](parse-positive-int-param-2026-05-13.md)
- [parseQueryString typed string query parameter parsing](parse-query-string-2026-05-13.md)
- [parseStringParam Express 5 string route param parsing](parse-string-param-2026-05-13.md)
