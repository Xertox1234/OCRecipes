---
title: 'Prettier-safe lint suppressions in JSX: trailing `//` on the prop line'
track: knowledge
category: conventions
module: client
tags: [eslint, prettier, jsx, react-native, lint-suppression]
applies_to: [client/**/*.tsx]
created: '2026-05-13'
---

# Prettier-safe lint suppressions in JSX: trailing `//` on the prop line

## Rule

When a lint check requires a comment on the **same line** as flagged code (e.g., `// hardcoded` for the color checker), use a trailing `//` comment on the JSX prop — not a `{/* */}` JSX comment:

## Examples

```tsx
// Good: // comment on the prop line — Prettier keeps it in place
<Ionicons
  name="checkmark-circle"
  size={16}
  color="#2E7D32" // hardcoded — semantic green for met-goal
/>

// Bad: {/* */} comment — Prettier moves it to the next line
<Ionicons name="checkmark-circle" size={16} color="#2E7D32" />{" "}
{/* hardcoded — Prettier puts this on line N+1, checker looks at line N */}
```

## When this applies

- Any lint suppression that must be on the same line as the flagged value
- `// hardcoded` opt-outs for the color checker
- `// eslint-disable-next-line` equivalents in JSX props

## Why

Prettier treats `{/* */}` as a JSX child element and freely reflows it onto separate lines. Trailing `//` comments on prop lines are preserved because Prettier won't split a prop from its trailing comment.

## Related Files

- `scripts/check-hardcoded-colors.js` — color checker that respects `// hardcoded`

## See Also

- [Custom lint scripts for accessibility and hardcoded colors](../best-practices/custom-lint-scripts-accessibility-colors-2026-05-13.md)
