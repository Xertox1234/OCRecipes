---
title: "Shared Button's fixed 52pt height clips its label at large text sizes"
status: backlog
priority: medium
created: 2026-11-22
updated: 2026-11-22
assignee:
labels: [deferred, accessibility, react-native]
github_issue:
---

# Shared Button's fixed 52pt height clips its label at large text sizes

## Summary

`client/components/Button.tsx` sets `height: Spacing.buttonHeight` (52). Its label is a
`ThemedText` with no font-scale cap, so at the iOS accessibility text sizes the label grows
past 52pt and is cut off top and bottom. Every `Button` in the app is affected.

## Background

Found during the pantry-card simulator check (2026-11-22) at
`accessibility-extra-extra-extra-large`: "Update pantry" showed only the middle of its
letters. The write cards were fixed locally by passing a style that grows the button
(`cardButtonGrowStyle` in `client/components/coach/blocks/write-cards/write-card-utils.ts`).
The shared component was left alone: that todo was scoped to the write cards, and
#1954 had just changed wrapped labels in `Button`.

## Acceptance Criteria

- [ ] At the largest accessibility text size, no `Button` label is clipped.
- [ ] At the default size every `Button` is still 52pt tall (no layout change).
- [ ] A test pins the change (pure style helper or equivalent, per the repo's test pattern).
- [ ] Once `Button` grows by itself, the write cards' `cardButtonGrowStyle` override is removed.

## Implementation Notes

- Likely `height` → `minHeight` plus a small `paddingVertical` in `Button`'s `styles.button`.
- Check callers that pass their own `height` in `style`; they keep winning, since `style` is
  applied after the base styles.
- Check the loading row (`ActivityIndicator` + `loadingText`) at large sizes too.
- Verify on the simulator with `xcrun simctl ui <UDID> content_size accessibility-extra-extra-extra-large`.

## Dependencies

- None.

## Risks

- Screens that lay out against an exact 52pt button (footers, sheets with fixed snap points);
  see `docs/solutions/logic-errors/bottom-sheet-fixed-height-cuts-off-its-buttons-when-content-grows-2026-11-16.md`.

## Updates

### 2026-11-22

- Initial creation (deferred from the pantry-card simulator check).
