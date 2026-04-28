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

| Hardcoded | Theme Value            |
| --------- | ---------------------- |
| `#FFFFFF` | `theme.buttonText`     |
| `#000000` | `theme.text`           |
| `#B5451C` | `theme.link`           |
| `#C94E1A` | `theme.calorieAccent`  |
| `#007A30` | `theme.success`        |
| `#FAF6F0` | `theme.backgroundRoot` |

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

### WCAG Re-verification After Background Color Change

When rebanding or changing background colours, every foreground colour that was previously WCAG-verified must be re-checked against the **new** background — not just the colours that changed.

**Why it fails silently:** A foreground colour like `#007A30` may pass 4.5:1 on white (`#FFFFFF`) but fail on a warm cream (`#FAF6F0`) because cream has lower luminance. The threshold is the same but the denominator shifted. Green is especially at risk — it typically sits close to the 4.5:1 minimum.

```
// Example from the 2026-04-25 rebrand:
// #008A38 on #FFFFFF → 4.48:1  ✓ (barely passes)
// #008A38 on #FAF6F0 → 4.20:1  ✗ (fails AA — cream bg is darker than white)
// Fix: darken to #007A30 → 5.1:1 on #FAF6F0 ✓
```

**Checklist when changing any background:**

1. Identify every foreground colour used against that background (text, links, icons, status indicators).
2. Recalculate contrast ratio for each using the new background luminance.
3. Pay particular attention to greens and mid-greys — they are closest to the 4.5:1 boundary.
4. Update WCAG ratio comments in `theme.ts` to reflect the new accurate values.

**Where it applies:** `backgroundRoot`, `backgroundDefault`, `backgroundSecondary` changes all affect every screen. Even a small luminance shift (white → cream) is enough to break borderline colours.

### Dynamic Color Injection into Static StyleSheet

When a component's `StyleSheet.create` block contains a hardcoded colour that needs to be theme-responsive, inject the theme value via array style at the call site instead of restructuring the entire component.

```typescript
// Static block — keeps layout/spacing props, drops the colour
const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
    backgroundColor: "transparent", // placeholder; overridden below
  },
});

// Dynamic override at call site — no component restructuring needed
<View style={[styles.badge, { backgroundColor: theme.link }]}>
```

**When to use:**

- A single colour in an otherwise-static stylesheet needs to follow the theme.
- The component already has `useTheme()` for other purposes.
- Restructuring the whole stylesheet into a theme-function pattern is disproportionate.

**When NOT to use:**

- If more than 2–3 colours in the stylesheet need theming — at that point restructure into `const styles = (theme: Theme) => StyleSheet.create({...})` and call it inside the component.

**Why:** Static `StyleSheet.create` blocks cannot reference `useTheme()` since they execute at module load time, before any React context exists. The array composition `[styles.foo, { key: value }]` is React Native's standard override mechanism — later entries win.
