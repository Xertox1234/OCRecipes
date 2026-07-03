---
title: ESLint ban on `as never` in tests via `TSAsExpression > TSNeverKeyword` selector
track: knowledge
category: best-practices
module: shared
tags: [testing, eslint, type-safety, no-restricted-syntax, ast]
applies_to: [eslint.config.js, '**/*.test.ts', '**/*.test.tsx']
created: '2026-05-13'
---

# ESLint ban on `as never` in tests via `TSAsExpression > TSNeverKeyword` selector

## When this applies

When you want to ban a specific TypeScript cast pattern (`as never`, `as any`, `as unknown as X`) globally or in a scoped file set (e.g., test files), use ESLint's `no-restricted-syntax` rule with an AST selector. This is more precise than text-based linting.

## Why

`as never` casts in tests bypass schema-compliant mock factories and hide type drift. Banning them at the AST level (rather than via regex/text search) catches the pattern wherever it appears, including inside generic constraints, return types, and conditional expressions.

## Examples

The `no-restricted-syntax` rule in `eslint.config.js` blocks `as never` casts in all `*.test.{ts,tsx}` files:

```javascript
{
  files: ["**/*.test.{ts,tsx}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "TSAsExpression > TSNeverKeyword",
        message: "Do not use 'as never' in tests. Use typed mock factories from server/__tests__/factories instead.",
      },
    ],
  },
},
```

This technique — using `TSAsExpression > TSNeverKeyword` AST selector — can be reused to ban other unsafe casts. The selector targets any `x as never` expression in the code.

## When to use

- Banning specific cast patterns in tests
- Enforcing a typed-factory convention by rejecting the escape hatch (`as never`)
- Any pattern reliably identified by a single TypeScript AST node type

## Exceptions

- When the pattern needs more context than an AST selector can express (use a custom ESLint rule instead — see `eslint-plugin-ocrecipes`)

## Related Files

- `eslint.config.js` — `no-restricted-syntax` rule for `**/*.test.{ts,tsx}`

## See Also

- [Typed mock factories for test data](../conventions/typed-mock-factories-for-test-data-2026-05-13.md)
- [Custom ESLint rules (`eslint-plugin-ocrecipes`)](custom-eslint-rules-eslint-plugin-ocrecipes-2026-05-13.md)
