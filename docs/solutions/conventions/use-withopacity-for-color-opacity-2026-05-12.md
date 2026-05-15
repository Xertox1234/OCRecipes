---
title: "Use withOpacity() for color opacity, never hex string concatenation"
track: knowledge
category: conventions
tags: [theme, colors, opacity, react-native, styling]
module: client
applies_to: ["client/**/*.tsx", "client/**/*.ts"]
symptoms:
  - "Hex strings concatenated with a two-char opacity suffix (theme.color + '20')"
  - "Magic two-character hex suffixes appearing inline in style values"
  - "Reviewer comments noting 'this looks like 20% but it's actually 12.5%'"
created: 2026-05-12
severity: low
---

# Use withOpacity() for color opacity, never hex string concatenation

## Rule

Use the `withOpacity()` utility from `@/constants/theme` (decimal 0–1 scale) for any partially-transparent colour. Never concatenate two-character hex opacity suffixes onto theme colour strings — the hex-decimal mismatch is non-obvious. `"20"` in hex is decimal 32, which is **12.5% opacity, not 20%**.

## Examples

```typescript
import { withOpacity } from "@/constants/theme";

// Good: Explicit decimal opacity (0-1 range)
backgroundColor: withOpacity(theme.success, 0.2); // 20% opacity
backgroundColor: withOpacity(theme.link, 0.1); // 10% opacity

// Bad: Magic hex suffix - unclear what opacity "20" represents
backgroundColor: theme.success + "20"; // Is this 20%? (No, it's 12.5%)
backgroundColor: theme.link + "33"; // What opacity is "33"?
```

## Why

The hex suffix approach is confusing because `"20"` in hex is 32 in decimal, which equals 12.5% opacity — not 20%. Using `withOpacity(color, 0.2)` clearly expresses "20% opacity." Beyond readability, the misreading produces actual UI bugs: a reviewer who reads `+ "20"` as 20% can sign off on a value that's almost half what they thought.

## Implementation

```typescript
// client/constants/theme.ts
export function withOpacity(hexColor: string, opacity: number): string {
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hexColor}${alpha}`;
}
```

## When this applies

- Badge backgrounds with transparency
- Overlay colors
- Disabled state backgrounds
- Any color needing partial opacity

## Hex-to-Opacity Conversion Reference

When migrating existing code, use this table to convert hex suffixes to decimal opacity:

| Hex Suffix | Decimal | Actual Opacity | withOpacity() Equivalent    |
| ---------- | ------- | -------------- | --------------------------- |
| `"10"`     | 16      | 6.3%           | `withOpacity(color, 0.06)`  |
| `"15"`     | 21      | 8.2%           | `withOpacity(color, 0.08)`  |
| `"20"`     | 32      | 12.5%          | `withOpacity(color, 0.125)` |
| `"30"`     | 48      | 18.8%          | `withOpacity(color, 0.19)`  |
| `"33"`     | 51      | 20%            | `withOpacity(color, 0.2)`   |
| `"40"`     | 64      | 25%            | `withOpacity(color, 0.25)`  |
| `"80"`     | 128     | 50%            | `withOpacity(color, 0.5)`   |
| `"FF"`     | 255     | 100%           | Just use the color directly |

## Exceptions

None. `withOpacity()` works inside both `useTheme()`-using components and static `StyleSheet.create` blocks (it's a pure function that takes a colour string).

## Related Files

- `client/constants/theme.ts` — `withOpacity()` definition (canonical 0–1 scale)

## See Also

- [Use theme values, not hardcoded colors](use-theme-values-not-hardcoded-colors-2026-05-12.md)
