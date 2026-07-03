---
title: Use named BorderRadius constants instead of magic numbers or calculations
track: knowledge
category: conventions
module: client
severity: low
tags: [theme, borderradius, design-tokens, react-native, styling, figma]
symptoms: ['Magic number borderRadius values (e.g. borderRadius: 19) in style blocks', Calculations like BorderRadius.chip - 9 obscuring the intended value, Same borderRadius value repeated across files without a shared name]
applies_to: [client/**/*.tsx, client/**/*.ts]
created: '2026-05-12'
---

# Use named BorderRadius constants instead of magic numbers or calculations

## Rule

Use semantic `BorderRadius.<name>` constants from `@/constants/theme` instead of magic numbers or arithmetic on existing constants. Calculations like `BorderRadius.chip - 9` hide the intended value behind algebra; magic literals like `19` hide it behind nothing at all.

## Examples

```typescript
// Good: Semantic name in theme
import { BorderRadius } from "@/constants/theme";

borderRadius: BorderRadius.chipFilled; // 19 - clear intent

// Bad: Magic number calculation
borderRadius: BorderRadius.chip - 9; // Why 9? What does this mean?
borderRadius: 19; // Magic number, no context
```

## Adding new semantic values

```typescript
// client/constants/theme.ts
export const BorderRadius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
  // Component-specific values from Figma
  card: 16,
  button: 12,
  chip: 28,
  chipFilled: 19, // Add semantic names for specific use cases
  input: 8,
  badge: 12,
};
```

## When to add a new semantic value

- Value comes from Figma design specs
- Same radius used in multiple places
- A calculation would otherwise be needed (`chip - 9`)
- The value has specific component meaning

## Why

1. **Self-documenting** — `chipFilled` explains what it's for.
2. **Single source of truth** — change once, updates everywhere.
3. **Figma alignment** — names can match Figma component names.
4. **No magic numbers** — calculations like `chip - 9` hide intent and break silently if `chip` is retuned.

## Exceptions

- `0` and very small one-off values (e.g. a 2px decorative line) can stay as literals; the threshold is "would a reader pause to ask _why this number?_"

## Related Files

- `client/constants/theme.ts` — `BorderRadius` constants

## See Also

- [Use theme values, not hardcoded colors](use-theme-values-not-hardcoded-colors-2026-05-12.md) — same principle applied to colours
