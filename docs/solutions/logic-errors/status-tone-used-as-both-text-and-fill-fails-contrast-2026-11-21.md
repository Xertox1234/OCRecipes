---
title: "A status colour used as both text and fill fails contrast in one of the two modes — split fill tokens from text tokens"
track: bug
category: logic-errors
tags: [design-system, accessibility, contrast, wcag, theme, dark-mode, react-native]
module: client
applies_to: ["client/constants/theme.ts", "client/lib/confidence.ts", "client/**/*.tsx"]
symptoms: ["White button text on a green or red fill is washed out in dark mode", "Orange or blue warning/info text is hard to read on the cream background in light mode", "A safety message (allergen check failed) renders below 4.5:1"]
created: '2026-11-21'
severity: high
---

# A status colour used as both text and fill fails contrast in one of the two modes — split fill tokens from text tokens

## Problem

`theme.success` / `theme.error` / `theme.warning` / `theme.info` were each used both as TEXT colours and as FILLS under white content. No single hex can be light enough to read as text on a dark background and dark enough to carry white text, so every tone failed one way in one mode.

## Symptoms

Accessibility audit 2026-11-21: dark `success` #4CAF7D and `error` #F16360 under white measured 2.71:1 and 3.14:1 (Log / Generate / Continue buttons, the destructive confirm, selected chips). Light `warning` #F57C00 and `info` #2196F3 as text on cream measured 2.51:1 and 2.90:1 (the "allergen check failed" message, confidence badges, the allergen warning banner). `error` text on its own 0.12 tint: 3.87:1.

## Root Cause

Only the accent colour had been split into `link` (text) and `accentSolid` (fill). The status tones never were, and the `badge*Text` tokens that already existed for status text were not used everywhere.

## Solution

- Fills under white content: new `successSolid` #007A30 and `errorSolid` #D32F2F (both modes; 5.49:1 / 4.98:1 under white, over 3:1 against the dark background). The shared destructive confirm (`getConfirmButtonStyle`) uses `errorSolid`.
- Status TEXT: `badgeSuccessText` / `badgeWarningText` / `badgeErrorText` / `badgeInfoText`. `getConfidenceColor` returns those (every caller draws it as text or a dot on a self-tint); a component that needs both (AllergenWarningBanner) keeps a fill tone and a separate text tone.
- `textSecondary` darkened #6B6B6B → #626262 for secondary text on `backgroundSecondary` cards (4.31:1 → 4.93:1).

## Prevention

- `client/constants/__tests__/status-text-colour-guard.test.ts` fails on `color: theme.warning|info` in a style object (one-line ternaries included). It cannot see a colour passed through a variable or a ternary split across lines — review owns those.
- `client/constants/__tests__/theme.test.ts` asserts the solid tokens and `textSecondary` contrast in both modes, using `test/utils/wcag-contrast.ts`.
- Measure text on the surface it actually sits on, including tints: a token that passes on cream can fail on its own 0.12 tint.

## Related Files

- `client/constants/theme.ts`, `client/lib/confidence.ts`, `client/components/AllergenWarningBanner.tsx`, `client/components/confirmation-modal-utils.ts`

## See Also

- `docs/rules/design-system.md` (accentSolid / link split)
- `docs/solutions/best-practices/recheck-wcag-after-background-color-change-2026-05-12.md`
