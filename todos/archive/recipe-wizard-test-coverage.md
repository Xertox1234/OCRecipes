---
title: "Recipe Wizard Test Coverage + Pure-Function Extraction"
status: complete
priority: high
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [testing, recipe-wizard, audit-followup]
---

# Recipe Wizard Test Coverage

## Summary

The recipe creation wizard (PR #40) replaced the tested `recipe-builder/`
directory (7 `__tests__/` files) with 8 untested files (~2,105 LOC). Write
focused tests for `WizardShell`, `PreviewStep`, `useRecipeForm`, and
`recipe-tag-inference`, extracting pure helpers where necessary.

## Background

Audit 2026-04-17 H9, M10, M21, L20, L21, L22 all cluster in this area.
The previous sheet-based implementation had explicit coverage; shipping the
wizard rewrite without tests was a measurable regression.

## Acceptance Criteria

- [x] `WizardShell` step transitions, save flow, edit-from-preview, and tag
      inference tested via React Testing Library (≥ 15 tests) — 19 tests
- [x] `PreviewStep`: extract `MacroItem` helper; fix `hasNutrition` to return
      `boolean`; thread section label into `EditButton.accessibilityLabel`
- [x] `useRecipeForm` prefill round-trip preserves quantity/unit structure
      (fixes M10 — snapshot + text-join, drops on edit)
- [x] `recipe-tag-inference` inference covers all 8 `DIET_TAG_OPTIONS` OR
      documents the intentional gap (L20) — documented + exhaustive test
- [x] `WizardShell.onDirtyChange` / `onSavingChange` fired from actions, not
      derived `useEffect` (L22)
- [x] `npx vitest run client/components/recipe-wizard client/hooks/__tests__/useRecipeForm client/lib/__tests__/recipe-tag-inference` → ≥ 30 new tests, all green — 107 passing

## Implementation Notes

- Extract pure helpers FIRST, then test. Render-heavy snapshots are brittle.
- Use existing `useScrollLinkedHeader.test.ts` as a Reanimated-mocking reference.
- Fix M21 (duplicate "Edit" labels) during the PreviewStep refactor — pass
  `label` prop through to `accessibilityLabel={`Edit ${label}`}`.

## Risks

- Reanimated worklets are notoriously hard to test; rely on the existing mock
  in `vitest.setup.ts`.
- Touching `PreviewStep` (503 LOC) risks UI regression — do the extraction in
  small, individually-verifiable commits.

## Related Audit Findings

- H9 (wizard zero tests), M10 (ingredient prefill round-trip), M21 (edit
  labels), L20 (diet tag inference gap), L21 (PreviewStep 503 LOC),
  L22 (useEffect for derived callbacks)

## Updates

### 2026-04-17

- Created during audit #11 Phase 4 (defer)
- Implemented and archived — all acceptance criteria met:
  - Pure helpers `MacroItem` + `hasNutrition` extracted from PreviewStep
  - `EditButton` now takes `label` prop; 6 unique section labels
  - `useRecipeForm` now captures structured snapshot at prefill time,
    invalidates on edit; round-trip preserves `"2.5"`/`"1/2"` fractions
    and `"tablespoons"` unit strings verbatim
  - `WizardShell` removed both derived `useEffect` blocks; passes
    stable callback to `useRecipeForm(prefill, { onDirtyChange })` and
    wraps `handleSave` in try/finally firing `onSavingChange`
  - `recipe-tag-inference.ts` documents Keto/Paleo/Low Carb/High Protein
    as intentionally not inferred (require macro data)
  - `test/mocks/react-native-reanimated.ts` added `SlideOutLeft` + `SlideOutDown`
  - 72 new tests total (19 WizardShell + 18 PreviewStep + 22 useRecipeForm
    - 13 recipe-tag-inference); suite at 107 green tests for the target scope
