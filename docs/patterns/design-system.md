# Design System Patterns

### Color Opacity Utility

Use the `withOpacity()` utility function instead of hex string concatenation for color opacity:

```typescript
import { withOpacity } from "@/constants/theme";

// Good: Explicit decimal opacity (0-1 range)
backgroundColor: withOpacity(theme.success, 0.2); // 20% opacity
backgroundColor: withOpacity(theme.link, 0.1); // 10% opacity

// Bad: Magic hex suffix - unclear what opacity "20" represents
backgroundColor: theme.success + "20"; // Is this 20%? (No, it's 12.5%)
backgroundColor: theme.link + "33"; // What opacity is "33"?
```

**Implementation:**

```typescript
// client/constants/theme.ts
export function withOpacity(hexColor: string, opacity: number): string {
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hexColor}${alpha}`;
}
```

**Hex to Opacity Conversion Reference:**

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

**When to use:**

- Badge backgrounds with transparency
- Overlay colors
- Disabled state backgrounds
- Any color needing partial opacity

**Why:** The hex suffix approach is confusing because `"20"` in hex is 32 in decimal, which equals 12.5% opacity—not 20%. Using `withOpacity(color, 0.2)` clearly expresses "20% opacity."

### Semantic Theme Values over Hardcoded Colors

Always use theme values instead of hardcoded color strings:

```typescript
import { useTheme } from "@/constants/theme";

const { theme } = useTheme();

// Good: Semantic theme values
color: theme.buttonText; // Instead of "#FFFFFF"
color: theme.text; // Instead of "#000000"
backgroundColor: theme.primary; // Instead of "#00C853"

// Bad: Hardcoded colors bypass theming
color: "#FFFFFF"; // Won't adapt to dark mode
color: "white"; // Same problem
```

**When to use:**

- All text colors
- All background colors
- All border colors
- All icon colors

**Why:**

1. **Dark mode support** - Theme values automatically switch between light/dark
2. **Design consistency** - Central source of truth for colors
3. **Maintainability** - Change colors in one place, not across files
4. **Semantic clarity** - `theme.buttonText` is clearer than `"#FFFFFF"`

**Common mappings:**

| Hardcoded | Theme Value           |
| --------- | --------------------- |
| `#FFFFFF` | `theme.buttonText`    |
| `#000000` | `theme.text`          |
| `#00C853` | `theme.primary`       |
| `#FF6B35` | `theme.calorieAccent` |
| `#F5F5F5` | `theme.background`    |

### Semantic BorderRadius Naming

Add semantic names to `BorderRadius` instead of using calculations:

```typescript
// Good: Semantic name in theme
import { BorderRadius } from "@/constants/theme";

borderRadius: BorderRadius.chipFilled; // 19 - clear intent

// Bad: Magic number calculation
borderRadius: BorderRadius.chip - 9; // Why 9? What does this mean?
borderRadius: 19; // Magic number, no context
```

**Adding new semantic values:**

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

**When to add a new semantic value:**

- Value comes from Figma design specs
- Same radius used in multiple places
- Calculation would otherwise be needed (`chip - 9`)
- Value has specific component meaning

**Why:**

1. **Self-documenting** - `chipFilled` explains what it's for
2. **Single source of truth** - Change once, updates everywhere
3. **Figma alignment** - Names can match Figma component names
4. **No magic numbers** - Calculations like `chip - 9` hide intent
