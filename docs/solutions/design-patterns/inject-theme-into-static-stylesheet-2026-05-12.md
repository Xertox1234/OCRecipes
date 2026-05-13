---
title: "Inject theme values into a static StyleSheet via array composition"
track: knowledge
category: design-patterns
tags: [theme, stylesheet, react-native, styling, composition]
module: client
applies_to: ["client/**/*.tsx"]
symptoms:
  - "A single colour in an otherwise-static StyleSheet needs to follow the theme"
  - "Component already uses useTheme() but its StyleSheet.create block can't read the hook"
  - "Tempted to restructure an entire stylesheet into a theme-function pattern for one colour"
created: 2026-05-12
severity: low
---

# Inject theme values into a static StyleSheet via array composition

## When this applies

A `StyleSheet.create` block contains one hardcoded colour that needs to be theme-responsive, the component already calls `useTheme()` for other purposes, and restructuring the whole stylesheet into a `(theme: Theme) => StyleSheet.create({...})` factory is disproportionate to fixing one value.

## Pattern

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

## Why

Static `StyleSheet.create` blocks cannot reference `useTheme()` because they execute at module load time, before any React context exists. The array composition `[styles.foo, { key: value }]` is React Native's standard override mechanism — later entries win. This lets you keep the layout/spacing static (which is what `StyleSheet.create` is good at) while injecting the one theme-dependent value at the call site.

## When NOT to use

If more than 2–3 colours in the stylesheet need theming, the array-override pattern multiplies at every call site. At that point restructure into a theme-function pattern:

```typescript
const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    badge: { backgroundColor: theme.link /* ... */ },
    text: { color: theme.text /* ... */ },
  });

// inside component
const styles = makeStyles(theme);
```

The threshold is judgment — 1 themed colour: array override; 4+: theme-function pattern; 2–3: prefer array override unless the component already does the theme-function pattern elsewhere.

## Related Files

- `client/constants/theme.ts` — `Theme` type and `useTheme()` hook

## See Also

- [Use theme values, not hardcoded colors](../conventions/use-theme-values-not-hardcoded-colors-2026-05-12.md) — the rule this pattern enables for static stylesheets
