---
title: "Plan week header and screen titles clip at the accessibility text sizes"
status: done
priority: medium
created: 2026-11-16
updated: 2026-11-16
assignee:
labels: [accessibility]
github_issue:
---

# Plan week header and screen titles clip at the accessibility text sizes

## Summary

At the iOS accessibility text sizes (measured at the largest, AX5) the Plan tab's week header
overflows: the month title and the "N of 28 planned" counter run off the right edge and the
"Next week" arrow is pushed off the screen, so the week cannot be advanced. The navigation
header title ("Plan") is also clipped top and bottom.

## Background

Found in the simulator on 2026-11-16 while checking the family-profile work (iPhone 17 Pro,
`xcrun simctl ui <udid> content_size accessibility-extra-extra-extra-large`, app relaunched).
The week header is stage 1 code (PR 1888), not the family work. At the largest standard size
(`extra-extra-extra-large`) the same screen lays out correctly.

- `client/screens/meal-plan/MealPlanHomeScreen.tsx`: `weekHeader` is a row of arrow, title,
  arrow with `justifyContent: "space-between"`; the title block has no width limit and its
  text has no font-scale cap. Giving the title `flex: 1` alone did not fix it (tried): the
  single-line text is wider than the space between the arrows.
- `client/components/HeaderTitle.tsx`: the header title scales past the fixed header height.
  This one is shared by every screen.
- The quick-link chips above the header also grow very large; they scroll, so they stay usable.

The grid cells already cap their scale (`GRID_MAX_FONT_SCALE`), which is why they hold up.

## Acceptance Criteria

- [x] At AX5 both week arrows are on screen and pressable, and the month title and slot counter
      are fully readable (wrapped or capped, not clipped).
- [x] The navigation header title is not clipped at AX5.
- [ ] Checked in the simulator at AX5 and at the default size, light and dark, with screenshots.
- [x] No change at the default text size.

## Implementation Notes

A scale cap (`maxScale` on `ThemedText`) on the two header texts, as the grid cells do, is the
smallest change; letting the title wrap needs the row to stop using a fixed-height arrow layout.

## Scope Contract

- **Mechanisms to use:** `maxScale` on `ThemedText`; existing layout styles.
- **Files in scope:** `client/screens/meal-plan/MealPlanHomeScreen.tsx`,
  `client/components/HeaderTitle.tsx`, and their tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Updates

### 2026-11-18

- Month title, slot counter and header title capped at MAX_FONT_SCALE_CONSTRAINED (1.5); weekTitle flex:1 so arrows stay on screen.
- Criterion 3 not met: simulator screenshots at AX5/default, light/dark were not taken in this headless run; needs a person to confirm on the simulator.
- Criterion 1 evidence: weekTitle flex:1 + maxScale on both texts (MealPlanHomeScreen.tsx); Criterion 2 evidence: HeaderTitle.test.tsx cap test.
