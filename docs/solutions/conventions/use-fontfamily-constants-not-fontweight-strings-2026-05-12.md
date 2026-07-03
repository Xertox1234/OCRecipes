---
title: Use FontFamily constants instead of fontWeight strings (Android-safe Poppins)
track: knowledge
category: conventions
module: client
severity: medium
tags: [theme, typography, fonts, react-native, android, poppins]
symptoms: ['fontWeight: ''600'' / ''500'' / ''bold'' in style blocks', Android text weight appears wrong (synthesised bold instead of true Poppins SemiBold), Letter spacing or stroke width differs between iOS and Android for the same component]
applies_to: [client/**/*.tsx, client/**/*.ts]
created: '2026-05-12'
---

# Use FontFamily constants instead of fontWeight strings (Android-safe Poppins)

## Rule

Always use `FontFamily` constants from `@/constants/theme` instead of inline `fontWeight` strings. The `FontFamily.<variant>` value resolves to the matching pre-built Poppins typeface (e.g. `"Poppins_600SemiBold"`); passing `fontWeight: "600"` instead leaves Android to synthesise bold from the regular variant, which looks visibly wrong.

## Examples

```typescript
import { FontFamily } from "@/constants/theme";

// Good: resolves to the correct pre-built Poppins variant
fontFamily: FontFamily.semiBold; // "Poppins_600SemiBold"
fontFamily: FontFamily.medium; // "Poppins_500Medium"
fontFamily: FontFamily.regular; // "Poppins_400Regular"

// Bad: tells Android to synthesize bold from the base typeface
fontWeight: "600";
fontWeight: "500";
fontWeight: "bold";
```

## Why it matters on Android

With custom fonts loaded via `expo-google-fonts`, Android maps `fontFamily: "Poppins_600SemiBold"` to the matching pre-built `.ttf` variant. When you use `fontWeight: "600"` instead, Android receives no `fontFamily` hint and synthesises a bold weight from whichever base typeface it resolves — typically the regular Poppins variant — producing visibly different letter spacing and stroke width compared to the true semibold cut.

iOS handles `fontWeight` more gracefully by searching the font bundle for matching weight descriptors, so the bug is **Android-only and easy to miss in iOS-first development**.

## Exceptions

- **Static `StyleSheet.create` blocks** are safe: `FontFamily` constants are plain string literals that do not depend on React context. They work outside `useTheme()`.
- If you genuinely need the platform-default system font (e.g. a debug overlay), `fontWeight` alone is acceptable — but flag it in review so the choice is intentional.

## Related Files

- `client/constants/theme.ts` — `FontFamily` constant
- `expo-google-fonts/poppins` — variant typefaces

## See Also

- [Use theme values, not hardcoded colors](use-theme-values-not-hardcoded-colors-2026-05-12.md) — same "named constant over raw value" principle
