---
title: "Recipe Wizard — A11y, Tap Targets & Polish"
status: done
priority: medium
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [recipe-wizard, accessibility, ui-polish, audit-followup]
---

# Recipe Wizard A11y, Tap Targets & Polish

## Summary

14 Medium/Low polish items in the recipe wizard + adjacent screens surfaced
in audit 2026-04-17. None are blocking but together they represent a
measurable accessibility and design-system gap.

## Background

Most of these cluster in `client/components/recipe-wizard/` and
`client/components/meal-plan/SearchFilterSheet.tsx`. Test coverage for
WizardShell is deferred to `recipe-wizard-test-coverage.md` — this todo is
for the non-test items.

## Acceptance Criteria

### Accessibility

- [ ] **M17** Guard wizard step slide animations (`SlideInRight`/`SlideOutLeft`)
      with `reducedMotion` from `useAccessibility()`
- [ ] **M20** Add `accessibilityLabel` to the 3 `Slider` elements in
      `SearchFilterSheet.tsx:95-145` (current: `testID` only)
- [ ] **M21** Thread `label` prop into `EditButton.accessibilityLabel` in
      `PreviewStep.tsx` — all 7 Edit buttons currently announce "Edit"
      (also covered by `recipe-wizard-test-coverage.md`)
- [ ] **L9** Add `AccessibilityInfo.announceForAccessibility("Saved")` when
      `AnimatedCheckmark` plays (visual-only success indicator today)

### Tap targets

- [ ] **M18** Increase hit slop on 5 profile hub modal close buttons in
      `RootStackNavigator.tsx:392-477` from `hitSlop={8}` to 44×44 min
      (either larger icon, larger container, or `hitSlop={12}`)
- [ ] **M19** Same for reorder controls in `InstructionsStep.tsx:217-227`
      (3 stacked buttons currently ~34px; target 44px)

### Performance

- [ ] **M23** Fix FlatList `renderItem` memoization in `IngredientsStep.tsx`
      and `InstructionsStep.tsx`: remove `ingredients.length`/`steps.length`
      from `useCallback` deps (add/remove row currently re-renders ALL rows);
      wrap row components in `React.memo`; spread `FLATLIST_DEFAULTS` from
      `@/constants/performance`
- [ ] **M24** Wrap `filledIngredients`, `ingredientSummary`, `instructionSummary`
      in `PreviewStep.tsx:83-101` with `useMemo`
- [ ] **M27** Replace `WizardShell.onDirtyChange` / `onSavingChange` useEffect
      with action-level fires (fire `onDirtyChange(true)` in the first
      mutating action, not via derived-state effect)

### Animation

- [ ] **L10** Add `Haptics.notificationAsync(Success)` to `useSuccessAnimation`
      trigger path; add `cancelAnimation` + reset on unmount / `reducedMotion`
      toggle

### Design system

- [ ] **L11** Replace 3 hardcoded `"#FFFFFF"` in wizard styles
      (`WizardShell.tsx:394`, `InstructionsStep.tsx:205`, `TagsStep.tsx:125`)
      with `theme.buttonText`
- [ ] **L12** Move 5 card accent colors in `RecipeEntryHubScreen.tsx`
      (`#7c6ffa`, `#f59e0b`, `#22c55e`, `#3b82f6`, `#ec4899`) to theme;
      check WCAG contrast. If they're intentional brand accents, add them as
      named theme tokens (`theme.accentPurple`, etc.)

### Code quality

- [ ] **L14** Replace `WizardShell` numeric-literal step branches
      (`nextStep === 6`, `setCurrentStep(7)`, `onEditStep(5)`) with named
      constants in `types.ts`: `STEP_TITLE = 1`, `STEP_INGREDIENTS = 2`, etc.
- [ ] **L25** Toggle `pointerEvents` on `RecipeBrowserScreen` filter chips
      when `opacity: 0` at collapsed state — invisible chips currently
      intercept taps on cards below at the boundary

## Implementation Notes

- M23 is actually a perf issue that affects typing lag on any wizard with
  10+ ingredients — bump priority if users complain before this lands.
- L12 debate: are these intentional brand colors (feature-hub visual
  hierarchy) or a styling oversight? Answer before moving to theme so we
  don't flatten intentional design differentiation.

## Related Audit Findings

M17, M18, M19, M20, M21, M23, M24, M27, L9, L10, L11, L12, L14, L25 (audit 2026-04-17)

## Updates

### 2026-04-17

- Created from audit #11 deferred Medium/Low items
