---
title: Use semantic theme values instead of hardcoded color strings
track: knowledge
category: conventions
module: client
severity: medium
tags: [theme, colors, dark-mode, react-native, styling]
symptoms: ['Hex color literals or named colors (e.g. "#FFFFFF", "white") inline in style values', Component renders correctly in light mode but breaks visually in dark mode, Same colour value duplicated across multiple files instead of one theme key]
applies_to: [client/**/*.tsx, client/**/*.ts]
created: '2026-05-12'
---

# Use semantic theme values instead of hardcoded color strings

## Rule

Always reference colour values through the `useTheme()` hook (`theme.<key>`), never as inline hex strings or CSS colour names. Hardcoded colours don't switch between light and dark mode, can't be retuned centrally, and obscure the intent of the colour at the call site.

## Examples

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

## Why

1. **Dark mode support** — theme values automatically switch between light and dark variants.
2. **Design consistency** — central source of truth for colours; rebrands touch one file.
3. **Maintainability** — change a colour in one place, not across every screen that referenced its hex.
4. **Semantic clarity** — `theme.buttonText` documents intent; `"#FFFFFF"` does not.

## When this applies

- All text colors
- All background colors
- All border colors
- All icon colors

## Common mappings

| Hardcoded | Theme Value            |
| --------- | ---------------------- |
| `#FFFFFF` | `theme.buttonText`     |
| `#000000` | `theme.text`           |
| `#B5451C` | `theme.link`           |
| `#C94E1A` | `theme.calorieAccent`  |
| `#007A30` | `theme.success`        |
| `#FAF6F0` | `theme.backgroundRoot` |

## Exceptions

- **Static `StyleSheet.create` blocks** cannot read `useTheme()` (they execute at module load, before any React context exists). For a single themed colour in an otherwise-static block, see [inject-theme-into-static-stylesheet](../design-patterns/inject-theme-into-static-stylesheet-2026-05-12.md).
- **`theme.buttonText` is `#FFFFFF` in both modes** — if you need pure white on a coloured button background that's identical in light/dark, `theme.buttonText` is the correct value (not a workaround).
- A handful of intentional hardcoded values exist in static styles (ScanScreen camera overlay, toggle thumbs). These are deliberate — they should not adapt.

## Related Files

- `client/constants/theme.ts` — theme definitions and `useTheme()` hook

## See Also

- [Use withOpacity() for color opacity](use-withopacity-for-color-opacity-2026-05-12.md)
- [Re-verify WCAG after background color change](../best-practices/recheck-wcag-after-background-color-change-2026-05-12.md)
- [Inject theme into a static StyleSheet](../design-patterns/inject-theme-into-static-stylesheet-2026-05-12.md)
