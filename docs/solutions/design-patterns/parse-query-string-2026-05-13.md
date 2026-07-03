---
title: parseQueryString for typed string query parameter parsing
track: knowledge
category: design-patterns
module: server
tags: [api, express, query-params, helper, typescript]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# parseQueryString for typed string query parameter parsing

## When this applies

Any route that reads a string query parameter (`?name=...`, `?date=...`, `?q=...`). Replaces every `req.query.x as string` cast in route handlers.

## Why

Express 5 types `req.query.*` as `unknown`. Casting to `string` silently smuggles `string[]` (e.g. `?name=a&name=b`) or `undefined` into business logic. The helper returns `string | undefined`, forcing the caller to handle the missing case.

## Examples

```typescript
import { parseQueryString } from "./_helpers";

// Before (unsafe):
const name = req.query.name as string;

// After (type-safe):
const name = parseQueryString(req.query.name);
```

Implementation:

```typescript
// server/routes/_helpers.ts
export function parseQueryString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value;
}
```

## Exceptions

- Numeric query params → use `parseQueryInt`
- Date query params → use `parseQueryDate` for automatic parsing
- Route params → use `parseStringParam`

## Enforcement

The `ocrecipes/no-as-string-req` ESLint rule flags `as string` casts on `req.query` in `server/routes/**/*.ts`.

## Related Files

- `server/routes/_helpers.ts` — implementation
- Route files: `micronutrients`, `nutrition`, `meal-plan`, `recipes` — consumers

## See Also

- [parseQueryInt typed query parameter parsing](parse-query-int-typed-query-parameter-2026-05-13.md)
- [parseStringParam Express 5 string route param parsing](parse-string-param-2026-05-13.md)
