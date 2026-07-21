---
title: 'Dark-mode accent token: split foreground (text) from fill (background)'
track: knowledge
category: conventions
module: client
tags: [accessibility, theming, dark-mode, wcag, design-system, color-tokens]
applies_to: [client/constants/theme.ts, client/**/*.tsx]
created: '2026-06-22'
last_updated: '2026-07-21'
---

# Dark-mode accent token: split foreground (text) from fill (background)

## Rule

A single accent token cannot serve BOTH as an on-dark **text/icon** color AND as a
solid **fill background** under white content in dark mode — the two roles are
mathematically incompatible. Split them: keep the foreground-tuned token (e.g.
`theme.link`) for `color`/`borderColor`/`tintColor`/`withOpacity` tints, and add a
separate fill token (e.g. `theme.accentSolid`) for solid `backgroundColor` under
white text/icons.

## Why

White text on a fill needs the fill to be DARK (low luminance) to reach 4.5:1. The
same token as TEXT on a dark surface needs to be LIGHT (high luminance) to reach
4.5:1. In dark mode these pull in opposite directions:

- `link #E07050` as text on `#1E1814` = 5.52:1 ✓ (tuned light for on-dark legibility)
- white `#FFFFFF` on `link #E07050` fill = **3.18:1 ✗** (too light to back white text)

No single value satisfies both. The conflict is invisible in light mode — a color
dark enough for white text is also dark enough to read on a light background, so
both roles share one hex (here `#B5451C`). It only bites when dark mode forces the
foreground token light. Button text at 16px is **normal** text → 4.5:1 applies, not
the 3:1 large-text floor.

The fill token `accentSolid #B5451C` = 5.48:1 vs white in BOTH modes; light mode is
byte-identical, only dark-mode fills change (`#E07050` → `#B5451C`).

## Smell patterns

- A solid `backgroundColor: theme.<accent>` (directly or via `const x = theme.<accent>`)
  carrying white text/icons, where the same accent is also used as on-dark `color:`.
- A WCAG comment claiming an accent "passes" that was verified only as TEXT, while the
  same token backs white content elsewhere.

## Examples

```ts
// theme.ts — one hex, two roles, documented so the next author picks correctly
link: "#E07050",        // dark mode: TEXT/icon/border/tint on dark bg (5.52:1)
accentSolid: "#B5451C", // dark mode: solid FILL under white content (5.48:1)

// Button.tsx primary variant
backgroundColor: theme.accentSolid,  // fill → accentSolid
textColor: theme.buttonText,         // white
// ghost/outline/link text stays on theme.link
```

## Exceptions

- `withOpacity(token, 0.04–0.2)` tints are light translucent backgrounds, NOT
  white-on-fill — keep them on the foreground token.
  
  **Caveat (badge/pill components):** This guidance is safe only when the token's
  own text-on-page contrast has enough margin above 4.5:1 to survive being the
  source of a low-opacity fill that the text sits directly on. When a component
  renders a token as both text/icon and its own tinted background (e.g., a badge
  pill using `withOpacity(color, 0.10–0.12)`), the effective background behind
  the text is the composited fill over the page, not the raw page background.
  A token verified only as opaque page text may drop below 4.5:1 once the
  fill shifts the background luminance. For example:
  - warning `#F57C00` text on its own 10% fill over `#FAF6F0` ≈ 2.3:1 (fail)
  - info `#2196F3` on its own 10% fill ≈ 2.6:1 (fail)
  - error `#D32F2F` on its own 10% fill ≈ 4.0–4.28:1 (fail — below 4.5:1)
  - success `#007A30` or textSecondary `#6B6B6B` on their own 10–12% fill
    also drop below AA, even though each passes as plain text on the page.
  
  **Fix:** Introduce component-specific token variants (e.g.,
  `badgeErrorText`, `badgeWarningText`, `badgeInfoText`, `badgeSuccessText`,
  `badgeNeutralText`) with colors computed via sRGB relative-luminance and
  alpha-composite math to guarantee ≥4.5:1 against the actual composited
  background in both light and dark modes. Verify with the shared utility in
  `test/utils/wcag-contrast.ts` and dedicated integration tests (e.g.,
  `client/components/__tests__/badge-contrast.test.ts`).

- Decorative fills with no text/icon (dots, bars) fall under WCAG 1.4.11 (3:1 non-text),
  not 1.4.3 — darkening is a nudge, not required, but migrate for consistency.
- Near-opaque tints (`withOpacity(token, ≥0.85)`) under white content behave as solid
  fills → use the fill token.

## Related Files

- `client/constants/theme.ts` — `accentSolid` token + WCAG ratio comments;
  badge-specific token variants added for error/warning/info/success/neutral
- `client/components/Button.tsx` — primary/default variant uses `accentSolid`
- `docs/rules/design-system.md` — the binding `link`-vs-`accentSolid` rule (auto-injected at write time)
- `test/utils/wcag-contrast.ts` — reusable sRGB relative-luminance + alpha-composite contrast calculator
- `client/components/__tests__/badge-contrast.test.ts` — integration tests verifying badge text vs composited fill for all variants

## See Also

- [token migration completeness](../best-practices/token-migration-sweep-misses-variable-and-prop-indirection-2026-06-22.md) — sweeping fills onto the new token without missing indirection
- [restore affordance after AA collapses a cue](restore-state-affordance-when-aa-fix-collapses-luminance-cue-2026-06-22.md) — the downstream disabled-state side-effect
- [Verify WCAG color contrast before adding new color tokens](wcag-color-contrast-2026-05-13.md) — the manual-checker convention this badge-fill caveat's deterministic test extends