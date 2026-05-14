---
title: "Custom lint scripts for accessibility and hardcoded colors"
track: knowledge
category: best-practices
tags: [eslint, accessibility, design-system, scripts, automated-enforcement]
module: client
applies_to: ["client/**/*.tsx", "scripts/check-*.js"]
created: 2026-05-13
---

# Custom lint scripts for accessibility and hardcoded colors

## When this applies

When a check requires reading multiple files, looking at file structure, or applying domain knowledge that doesn't fit cleanly into an ESLint rule, write a standalone Node script under `scripts/` and wire it into `lint-staged` for pre-commit enforcement.

## Why

ESLint rules run per-file with no cross-file awareness. Custom scripts can grep, traverse directories, parse JSX, and produce richer error messages — at the cost of running outside the editor's live-feedback loop.

## Examples

| Script                              | Scope             | Checks                                                                                                                                  |
| ----------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-accessibility.js`    | `client/**/*.tsx` | `Pressable`/`TouchableOpacity` with `onPress` missing `accessibilityLabel`; `TextInput` without `accessibilityLabel`                    |
| `scripts/check-hardcoded-colors.js` | `client/**/*.tsx` | All hex colors (`#RGB`, `#RRGGBB`, etc.) and named CSS colors (`"white"`, `"black"`, etc.). Opt out with `// hardcoded` inline comment. |

## When to use

- Cross-file invariants (e.g., "every screen that uses X must also import Y")
- JSX-level checks that need to inspect prop combinations
- Patterns that need richer error messages than ESLint's `messageId` system

## Exceptions

- Single-file AST patterns — use `no-restricted-syntax` or a custom ESLint rule instead so the developer sees the issue live in the editor

## Related Files

- `scripts/check-accessibility.js` — accessibility check for `Pressable`/`TouchableOpacity`/`TextInput`
- `scripts/check-hardcoded-colors.js` — hardcoded color check with `// hardcoded` opt-out

## See Also

- [Prettier-safe lint suppressions in JSX](../conventions/prettier-safe-lint-suppressions-jsx-2026-05-13.md)
- [`@vitest-environment jsdom` pragma required for component tests](jsdom-pragma-required-for-component-tests-2026-05-13.md)
