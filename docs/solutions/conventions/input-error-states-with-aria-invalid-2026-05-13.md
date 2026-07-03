---
title: Input error states with aria-invalid (not accessibilityState invalid)
track: knowledge
category: conventions
module: client
tags: [react-native, accessibility, forms, aria, errors, typescript]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Input error states with aria-invalid (not accessibilityState invalid)

## Rule

Use `aria-invalid` (not `accessibilityState={{ invalid: true }}`) to mark inputs in an error state. React Native's `AccessibilityState` type does not include `invalid` — using `accessibilityState={{ invalid: true }}` causes a TypeScript error. The `aria-invalid` prop is the correct cross-platform ARIA prop supported since RN 0.71.

## Examples

```tsx
// Destructure accessibilityHint so it does NOT appear in {...props}
const { accessibilityHint, error, errorMessage, ...props } = componentProps;

<RNTextInput
  aria-invalid={error ? true : undefined}
  accessibilityHint={
    error && errorMessage
      ? accessibilityHint
        ? `${accessibilityHint}. ${errorMessage}`
        : errorMessage
      : accessibilityHint
  }
  {...props}
/>;
```

## Why

**Hint preservation:** When an error occurs, append the error message to the caller-supplied `accessibilityHint` rather than replacing it. Replacing it silently discards the caller's hint (e.g., "Enter a valid email address"). Appending with `. ` preserves both: VoiceOver/TalkBack reads the original hint then the error detail.

**Spread override gotcha:** In JSX, if the same prop key appears twice, the last occurrence wins. A `{...props}` spread that comes after an explicit `accessibilityHint={computed}` will silently override the computed value with the caller's original. Destructuring `accessibilityHint` out of the rest spread prevents this — it removes the key from `props` so the spread cannot clobber the computed value. See also `docs/legacy-patterns/typescript.md` "Prop Shielding in Wrapper Components".

## Related Files

- `client/components/TextInput.tsx` — shared input component with error state

## See Also

- [`role` prop for unsupported ARIA roles](role-prop-for-unsupported-aria-roles-2026-05-13.md)
- [Inline validation errors](inline-validation-errors-2026-05-13.md)
