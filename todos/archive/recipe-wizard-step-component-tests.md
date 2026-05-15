---
title: "Step-component tests for recipe wizard (7 untested screens)"
status: complete
priority: medium
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [testing, recipe-wizard]
---

# Step-component Tests for Recipe Wizard

## Summary

`WizardShell` integration tests stub all 7 step components. The steps
themselves (~1,500 LOC across `TitleStep`, `IngredientsStep`, `StepsStep`,
`TimeServingsStep`, `NutritionStep`, `TagsStep`, `PreviewStep`) have direct
coverage only for `PreviewStep`. Add focused tests for the remaining 6.

## Background

Follow-up from audit #11 code review of commit `fe87638`
(recipe-wizard-test-coverage). The reviewer (L3) flagged that
`WizardShell.test.tsx` legitimately stubs children for isolation, but the
underlying step screens are still untested in this repo. `PreviewStep` has
its own suite; the other 6 do not.

## Acceptance Criteria

- [ ] `TitleStep`: validation, character-limit behavior, keyboard handling
- [ ] `IngredientsStep`: add/remove rows, focus management, voice-input hook
      integration (if any)
- [ ] `StepsStep`: add/remove steps, reorder affordance (if present)
- [ ] `TimeServingsStep`: numeric validation, min/max guards
- [ ] `NutritionStep`: optional-field skip flow, numeric validation
- [ ] `TagsStep`: cuisine + diet-tag selection, chip toggle behavior
- [ ] Each step: ≥ 4 tests covering happy path + one edge case
- [ ] All tests green in `npx vitest run client/components/recipe-wizard`

## Implementation Notes

- Read `client/components/recipe-wizard/__tests__/PreviewStep.test.tsx`
  as a reference — it shows the right balance of pure-helper + rendered
  assertions for this area.
- Extract pure helpers (validators, formatters) before rendering tests;
  keep render tests to one-or-two happy-path assertions per step.
- Reuse the `test/mocks/react-native-reanimated.ts` mock for any step that
  uses `Animated.View` / layout animations.

## Dependencies

- None.

## Risks

- `IngredientsStep` may integrate with `useSpeechToText` — if so, test-side
  mock needed (precedent: existing suite may already mock it).
- Step screens use `Animated.FlatList` / `Reanimated` list animations;
  confirm the current mock covers them or extend it.

## Updates

### 2026-04-17

- Created as L3 follow-up from code review of commit `fe87638`.
- Implemented and archived — acceptance criteria met:
  - Pure helpers extracted into 6 new `*-utils.ts` files (`title-step-utils`,
    `ingredients-step-utils`, `instructions-step-utils`,
    `time-servings-step-utils`, `nutrition-step-utils`, `tags-step-utils`).
  - 94 new tests total across 6 new test files — each step has ≥ 4 tests
    and covers happy-path + edge cases:
    - TitleStep: 15 (validation, trimming, maxLength constants, render)
    - IngredientsStep: 14 (add/remove guard, filled count, render)
    - InstructionsStep: 12 (reorder affordance, delete guard, render)
    - TimeServingsStep: 19 (clamp 1..99, sanitize input, total minutes)
    - NutritionStep: 13 (skip flow, numeric + decimal sanitation, render)
    - TagsStep: 15 (toggle chip behavior, cuisine suggested badge, render)
  - `test/mocks/react-native.ts` TextInput mock: added
    `accessibilityLabel → aria-label` mapping and `onChangeText` wiring so
    `getByLabelText` / `fireEvent.change` work for rendered step tests.
    Change is additive — all 3812 existing tests remain green.
