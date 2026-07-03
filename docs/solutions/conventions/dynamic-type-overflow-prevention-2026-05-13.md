---
title: Dynamic Type overflow prevention with maxScale on fixed-height containers
track: knowledge
category: conventions
module: client
tags: [react-native, accessibility, dynamic-type, fonts, themedtext]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-07-03'
---

# Dynamic Type overflow prevention with maxScale on fixed-height containers

## Rule

iOS Dynamic Type scales all `<Text>` by default — correct for accessibility. But text in **fixed-height containers** (tab bars, badges, chips, toasts) will overflow at extreme sizes. Use `ThemedText`'s `maxScale` prop to cap scaling.

## Examples

```typescript
import { MAX_FONT_SCALE_CONSTRAINED } from "@/constants/theme";

// Cap at 1.5x in a fixed-height badge
<ThemedText maxScale={MAX_FONT_SCALE_CONSTRAINED} style={styles.badgeLabel}>
  {label}
</ThemedText>
```

## Why

**Rules:**

- Always use `maxScale` on `ThemedText` — never pass `maxFontSizeMultiplier` directly (ThemedText strips it to prevent conflicts)
- Use `MAX_FONT_SCALE_CONSTRAINED` (1.5) for standard constrained containers; use a custom value (e.g. 1.3) for very tight spaces like camera overlays
- Never apply `maxScale` to body text in scrollable areas — that defeats the accessibility purpose
- Only constrain text that lives in a genuinely fixed-height layout (tab bar, badge pill, chip, toast, progress bar label)

## Exceptions

Where it's applied: Tab bar labels, CalorieBudgetBar, Chip, VerificationBadge, AllergenBadge, FastingStreakBadge (compact), Toast, OfflineBanner, ScanScreen reticle text, HistoryScreen stat values.

## Related Files

- `client/constants/theme.ts` — `MAX_FONT_SCALE_CONSTRAINED`
- `client/components/ThemedText.tsx`
