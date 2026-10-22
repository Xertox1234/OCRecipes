---
title: "Two-thirds of text inputs show only a cursor on tap — 44 inputs bypass the shared animated TextInput"
status: in-progress
priority: medium
created: 2026-10-20
updated: 2026-10-20
assignee:
labels: [deferred, ui, react-native]
github_issue:
---

# Two-thirds of text inputs show only a cursor on tap

## Summary

44 of the app's 69 text inputs (41 react-native `TextInput` in 27 files, plus 3
`BottomSheetTextInput`) bypass the shared animated `client/components/TextInput.tsx`, so tapping
them gives no visible response beyond the blinking cursor — the exact "flat" complaint the
2026-10-09 interaction-feel pass was meant to fix. None of the 27 files has an `onFocus` handler.

## Background

Found 2026-10-20 while scoping the front-end design deep research (motion / microinteractions
knowledge base). The interaction-feel skill says "Every screen gets the focus border
automatically" (`.claude/skills/interaction-feel/SKILL.md:59-60`), but that holds only for
screens that render the shared component. The skill fires when an agent builds or touches an
element, so surfaces nobody edited after #660 never got the treatment.

Highest-traffic examples: the Coach chat composer (`client/components/coach/CoachChatBase.tsx`),
`ChatScreen`, `RecipeChatScreen`, every recipe-wizard step, the home drawers, `GoalSetupScreen`
(5 inputs), and the grocery / pantry screens.

Measurement (2026-10-20, main @1b58bba6): a whole-file perl scan for
`import { … TextInput … } from "react-native"` that handles multi-line imports (a line-based grep
finds only 7 of the 27 files), plus `<TextInput` counts. Shared-component usages: 25 in 14 files,
of which only 5 opt into the floating `label` (ChangePasswordScreen ×3, CookbookCreateScreen ×2).
Even where it applies, the focus treatment is a 1px border-colour fade over 160 ms
(`focusTimingConfig`, `client/constants/animations.ts:53`).

Raw react-native `TextInput` files (count of `<TextInput`):
ReceiptReviewScreen 2, ChatScreen 2, NotebookEntryScreen 1, QuickLogScreen 1,
AllConversationsScreen 1, PhotoAnalysisScreen 3, GoalSetupScreen 5, RecipeChatScreen 1
(all `client/screens/`); meal-plan/RecipeBrowserScreen 1, meal-plan/RecipeAIGenerateScreen 2,
meal-plan/GroceryListScreen 2, meal-plan/GroceryListsScreen 2, meal-plan/RecipeImportScreen 1,
meal-plan/PantryScreen 2 (under `client/screens/`); CookbookPickerModal 1,
GroceryListPickerModal 1, home/QuickLogDrawer 1, home/GenerateRecipeDrawer 1,
home/RecipeSearchDrawer 1, recipe-wizard/TimeServingsStep 2, recipe-wizard/TitleStep 2,
recipe-wizard/InstructionsStep 1, recipe-wizard/NutritionStep 1, recipe-wizard/TagsStep 1,
recipe-wizard/IngredientsStep 1, coach/CoachChatBase 1, recipe-detail/ServingStepperChip 1
(under `client/components/`). Bottom-sheet inputs: `client/components/BeveragePickerSheet.tsx`,
`client/components/meal-plan/SimpleEntrySheet.tsx`.

## Acceptance Criteria

- [ ] Every text-entry surface in `client/` renders through a shared input primitive that carries
      the focus feedback — the existing `TextInput`, or sibling variants for shapes it doesn't fit
      (e.g. a chat composer, an inline numeric stepper field, a bottom-sheet field). No screen
      renders a bare react-native `TextInput`.
- [ ] A structural check stops new bypasses — e.g. an ESLint `no-restricted-imports` entry for
      `TextInput` from `react-native` (and `BottomSheetTextInput`) outside the shared primitives,
      with a narrow allow-list. Type-only imports used for refs stay allowed.
- [ ] Reduced motion still snaps to the focused end state (the state change is kept, the motion
      is dropped).
- [ ] `.claude/skills/interaction-feel/SKILL.md` "Shipped focus patterns" matches reality (no
      "every screen gets it automatically" unless that is now true).
- [ ] Simulator check (`verify-ui`) of at least the Coach composer and one recipe-wizard step
      in the focused state.

## Implementation Notes

- This todo is about COVERAGE (every input answers back), not the final look. The focus
  treatment's design and amplitude may change after the 2026-10-20 design research — check
  with the owner before changing the treatment itself.
- Chat composers likely need a variant that animates the composer container rather than a boxed
  1px border.
- `ServingStepperChip` / `NutritionStep` numeric fields: confirm keyboard and selection behaviour
  survive the swap.
- `client/screens/NutritionDetailScreen.tsx` imports `TextInput` from react-native but renders
  none (likely a ref type) — leave it.

## Scope Contract

- **Mechanisms to use:** the shared `client/components/TextInput.tsx` plus sibling variants under
  `client/components/`; one ESLint `no-restricted-imports` entry.
- **Files in scope:** the 27 files and 2 bottom-sheet files listed above,
  `client/components/TextInput.tsx`, `client/components/text-input-utils.ts`, new variant files
  under `client/components/`, the ESLint config, `.claude/skills/interaction-feel/SKILL.md`.
- No new animation libraries, no new mechanisms beyond those listed.

## Dependencies

- None blocking. The focus treatment's design may be informed by the 2026-10-20 design research.
