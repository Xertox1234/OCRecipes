---
title: 'Extract shared Record<string, string> color maps into domain-scoped constants files'
track: knowledge
category: design-patterns
module: client
severity: low
tags: [colors, constants, dry, react-native, theme, accessibility]
symptoms: ['The same Record<string, string> colour dictionary appears in two or more files', Adding a new entry to a category-color map requires touching multiple files, 'Two consumers drift apart on the same colour map (different fallbacks, different keys)']
applies_to: [client/**/*.tsx, client/**/*.ts]
created: '2026-05-12'
---

# Extract shared Record<string, string> color maps into domain-scoped constants files

## When this applies

The same `Record<string, string>` colour dictionary (e.g. notebook entry type colours, category badge colours) appears in two or more files. Extract it once to a dedicated constants file rather than letting copies drift apart.

## Pattern

```ts
// client/constants/notebook-colors.ts  (or similar domain-scoped file)
export const TYPE_COLORS: Record<string, string> = {
  commitment: "#f59e0b",
  insight: "#7c6dff",
  goal: "#008A38",
  preference: "#06b6d4",
  coaching_strategy: "#06b6d4",
  motivation: "#ec4899",
  emotional_context: "#ec4899",
  conversation_summary: "#888888",
};
```

```ts
// Any consumer — import once
import { TYPE_COLORS } from "@/constants/notebook-colors";
const color = TYPE_COLORS[entry.type] ?? theme.textSecondary;
```

## Rules

- **One constants file per feature domain** (`notebook-colors.ts`, not a monolithic `colors.ts`). Monolithic colour files become their own kind of duplication-target.
- **Verify WCAG contrast** on cream (`#FAF6F0`) and dark backgrounds when adding new values — see [recheck-wcag-after-background-color-change](../best-practices/recheck-wcag-after-background-color-change-2026-05-12.md).
- **Use `?? theme.textSecondary` fallback at call sites** so unknown types render safely instead of crashing on `undefined`.

## Why

1. **Single source of truth** — adding a new entry type updates every consumer at once.
2. **Domain scoping** — `notebook-colors.ts` ties the map to the feature that owns it; consumers know where to look without grep-spelunking.
3. **Safe defaults** — the `??` fallback means unknown keys degrade to readable rather than blank.

## Exceptions

- A map used in exactly one file should stay inline. Premature extraction creates indirection without DRY benefit.

## Related Files

- `client/constants/notebook-colors.ts`
- `client/screens/NotebookScreen.tsx`, `client/screens/NotebookEntryScreen.tsx`
- Audit finding M13 (2026-05-09) — the audit that prompted this pattern

## See Also

- [Use theme values, not hardcoded colors](../conventions/use-theme-values-not-hardcoded-colors-2026-05-12.md) — covers single-purpose colour values; this pattern covers map-shaped colour data
- [Re-verify WCAG after background color change](../best-practices/recheck-wcag-after-background-color-change-2026-05-12.md) — required check when extending these maps
