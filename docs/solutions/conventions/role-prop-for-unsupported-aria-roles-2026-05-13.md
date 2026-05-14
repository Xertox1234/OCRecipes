---
title: "Use role prop for ARIA roles not in accessibilityRole"
track: knowledge
category: conventions
tags: [react-native, accessibility, aria, role, typescript]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Use role prop for ARIA roles not in accessibilityRole

## Rule

When `accessibilityRole` doesn't support a needed value (like `"group"`), use the `role` prop instead. The `role` prop supports all ARIA roles (RN 0.73+).

## Examples

```tsx
// Bad: "group" is not in accessibilityRole's type union — TS error
<View accessibilityRole="group" accessibilityLabel="Side effects">

// Good: role prop supports all ARIA roles (RN 0.73+)
<View role="group" accessibilityLabel="Side effects">
```

## Why

The legacy `accessibilityRole` prop ships with a limited string-union type that omits roles like `"group"`, `"list"`, `"listitem"`, `"form"`. The newer `role` prop accepts the full ARIA role set, sidesteps the type error, and is what modern React Native expects.

## Exceptions

When to use: ARIA roles not in `accessibilityRole`'s type union: `"group"`, `"list"`, `"listitem"`, `"form"`, etc.

When NOT to use: Roles that `accessibilityRole` already supports (`"button"`, `"radiogroup"`, `"checkbox"`, `"alert"`, etc.) — prefer `accessibilityRole` for consistency with the rest of the codebase.

## Related Files

- `client/screens/GLP1CompanionScreen.tsx` — `role="group"` on checkbox group container

## See Also

- [Radio/checkbox group container pattern](../design-patterns/radio-checkbox-group-container-pattern-2026-05-13.md)
- [Input error states with aria-invalid](input-error-states-with-aria-invalid-2026-05-13.md)
