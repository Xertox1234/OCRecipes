---
title: "Verify WCAG color contrast (4.5:1 AA) before adding new color tokens"
track: knowledge
category: conventions
tags: [accessibility, wcag, colors, contrast, theme]
module: client
applies_to: ["client/constants/theme.ts", "client/constants/**/*colors*.ts"]
created: 2026-05-13
---

# Verify WCAG color contrast (4.5:1 AA) before adding new color tokens

## Rule

Light mode color tokens must maintain at least 4.5:1 contrast ratio against white backgrounds (WCAG 2.1 AA). When adding new color tokens, verify contrast at [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/) before committing.

## Examples

Current compliant values:

| Token                           | Value     | Ratio  |
| ------------------------------- | --------- | ------ |
| `textSecondary`                 | `#717171` | ~4.5:1 |
| `success` / `proteinAccent`     | `#008A38` | ~4.6:1 |
| `calorieAccent` / `carbsAccent` | `#C94E1A` | ~4.6:1 |
| `fatAccent`                     | `#8C6800` | ~5.1:1 |

## Why

Anything below 4.5:1 fails WCAG 2.1 AA. Greens and mid-greys near the threshold flip from pass to fail with small luminance shifts — verification at commit time catches regressions that look visually trivial.

## Related Files

- `client/constants/theme.ts`

## See Also

- [Re-verify WCAG contrast for every foreground after a background color change](../best-practices/recheck-wcag-after-background-color-change-2026-05-12.md)
- [Use theme values, not hardcoded colors](use-theme-values-not-hardcoded-colors-2026-05-12.md)
