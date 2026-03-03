---
title: "Fix ipKeyGenerator TypeScript error in routes.ts"
status: complete
priority: high
created: 2026-02-04
updated: 2026-02-05
assignee:
labels: [bug, typescript]
---

# Fix ipKeyGenerator TypeScript Error

## Summary

TypeScript compilation fails due to `ipKeyGenerator` being used before it's defined in `server/routes.ts`. This blocks type checking from passing cleanly.

## Background

Running `npm run check:types` produces these errors:

```
server/routes.ts(76,40): error TS2304: Cannot find name 'ipKeyGenerator'.
server/routes.ts(85,40): error TS2304: Cannot find name 'ipKeyGenerator'.
server/routes.ts(941,42): error TS2304: Cannot find name 'ipKeyGenerator'.
```

The `ipKeyGenerator` function is likely defined later in the file but referenced earlier in rate limiter configurations.

## Acceptance Criteria

- [x] `npm run check:types` passes without `ipKeyGenerator` errors
- [x] All rate limiters function correctly
- [x] No runtime regressions in rate limiting behavior

**Note:** Issue was already resolved - `ipKeyGenerator` is defined at line 57, before its first usage at line 81.

## Implementation Notes

Options to fix:

1. Move `ipKeyGenerator` definition above its first usage
2. If it's imported, ensure the import is at the top of the file
3. If it's a hoisting issue with `const`/`let`, consider using `function` declaration instead

## Dependencies

- None

## Risks

- Reordering code could have unintended side effects if there are initialization dependencies

## Updates

### 2026-02-04

- Initial creation - discovered during profile editing feature work
