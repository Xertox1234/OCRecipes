---
title: "Fix __dirname error in check-accessibility.js"
status: complete
priority: low
created: 2026-02-04
updated: 2026-02-05
assignee:
labels: [lint, scripts]
---

# Fix \_\_dirname error in check-accessibility.js

## Summary

ESLint reports `__dirname is not defined` error at line 239 in `scripts/check-accessibility.js`. This is because `__dirname` is a CommonJS global that doesn't exist in ES modules.

## Background

The script uses ES module syntax but references `__dirname`, which is only available in CommonJS. This causes ESLint to report a `no-undef` error.

## Acceptance Criteria

- [x] ESLint passes without the `__dirname` error
- [x] Script functionality remains unchanged

## Implementation Notes

Two options to fix:

1. **Convert to CommonJS** - Rename to `.cjs` or use `require()` syntax
2. **Use ESM equivalent** - Replace `__dirname` with:

   ```js
   import { fileURLToPath } from "url";
   import { dirname } from "path";

   const __filename = fileURLToPath(import.meta.url);
   const __dirname = dirname(__filename);
   ```

## Dependencies

- None

## Risks

- None, straightforward fix

## Updates

### 2026-02-04

- Initial creation (discovered during lint check for interactive suggestion cards feature)
