---
title: "Audit and fix Dynamic Type overflow at 200% text size"
status: done
priority: medium
created: 2026-03-27
updated: 2026-03-29
assignee:
labels: [accessibility, client, visual-qa]
---

# Audit and fix Dynamic Type overflow at 200% text size

## Summary

Run the app at iOS maximum Dynamic Type size, identify all layouts that overflow or clip, and add `maxFontSizeMultiplier` to constrained containers.

## Background

The accessibility audit found only 3 occurrences of `maxFontSizeMultiplier` in the entire codebase (HistoryScreen, ScanScreen). React Native scales all text by default with system font size preferences, which is correct for accessibility — but text in fixed-height containers (tab labels, badges, chips, progress bars) will overflow at extreme sizes.

Key areas identified as at-risk:

- Tab bar labels (11pt in 88pt fixed tab bar)
- CalorieBudgetBar numerical values
- Chip components (11-12pt in constrained pills)
- Badge text on recipe cards (11pt in small absolute-positioned badge)
- Progress bar labels
- Toast action button text

## Acceptance Criteria

- [ ] Manual QA pass completed at iOS Accessibility > Larger Text > maximum size
- [ ] Screenshots taken of every screen at 200% text size (before/after)
- [ ] `maxFontSizeMultiplier={1.5}` added to text in fixed-height containers
- [ ] Tab bar labels don't overflow or collide with icons
- [ ] Badge/chip text doesn't clip or overflow container
- [ ] Scrollable content areas scale naturally (no maxFontSizeMultiplier needed)
- [ ] No regressions at normal text size

## Implementation Notes

- This requires the iOS simulator running — set Dynamic Type via Settings > Accessibility > Display & Text Size > Larger Text
- `maxFontSizeMultiplier` is a prop on `<Text>` and `<TextInput>` components
- Value of 1.5 means text can grow up to 150% of its base size (a reasonable cap for constrained layouts)
- The ThemedText component could accept a `maxScale` prop to centralize this
- Don't apply `maxFontSizeMultiplier` to body text in scrollable areas — that defeats the accessibility purpose

## Dependencies

- iOS Simulator or physical device for visual verification
- Cannot be done blind — visual confirmation required

## Risks

- Over-constraining text scale defeats the accessibility purpose — only constrain in truly fixed layouts
- Some users rely on 200%+ text — capping at 1.5x is a compromise, not ideal

## Updates

### 2026-03-27

- Identified during launch readiness audit (accessibility H5)
- 239 reducedMotion references show strong a11y awareness — this is the main remaining gap
