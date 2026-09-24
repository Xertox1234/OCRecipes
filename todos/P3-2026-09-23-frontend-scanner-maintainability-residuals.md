---
title: "Front-end scanner residuals: unused ServingStepperChip export, duplicated prod blocks, and 26 client files over 600 lines"
status: backlog
priority: low
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, maintainability]
github_issue:
---

# Front-end scanner residuals: unused ServingStepperChip export, duplicated prod blocks, and 26 client files over 600 lines

## Summary

Deterministic-scanner findings for `client/` that aren't covered by a more specific todo. It's a backlog of structural cleanups, to be picked off opportunistically.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **L17, SCAN-KNIP-13, SCAN-JSCPD, SCAN-FLEN** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- knip: unused export `ServingStepperChip` from `client/components/recipe-detail/index.ts`.
- jscpd production duplicates: CameraView.tsx ↔ CameraView.ios.tsx (36 + 77 lines), ChangeEmailModal ↔ DeleteAccountModal (54), AddItemMenuSheet ↔ ImportRecipeSheet (43), NutritionPanel ↔ NutritionSummaryCard (36), plus smaller ones (Button ↔ CoverActionButton, CookbookPickerModal ↔ GroceryListPickerModal, InlineMicButton ↔ VoiceLogButton, MicronutrientSection ↔ CollapsibleSection, QuickAddSheet ↔ SimpleEntrySheet). Test-file duplicates are lower value.
- File length: at least 26 client files exceed 600 lines. The scanner printed 20 of 44 repo-wide; its cap hid MealPlanHomeScreen 1700, RecipeBrowserScreen 1267, GroceryListScreen 727, PantryScreen 650 and CookbookCreateScreen 637. The biggest ones have their own structural todos (useNutritionLookup, MealPlanHome sheets, RecipeBrowser filters).
- madge nav cycles: FALSE POSITIVE (all `import type`), so no action.
- Re-run: `npx tsx scripts/audit-scanners.ts code-quality`.

## Acceptance Criteria

- [ ] The unused export is removed (after LSP findReferences confirms no consumer)
- [ ] At least the CameraView and ChangeEmail/DeleteAccount duplicates are resolved or explicitly accepted with a rationale
- [ ] Consider raising the scanner's per-tool cap or printing a 'hidden by cap' list (scripts/audit-scanners.ts) so large files aren't hidden
- [ ] Scanner re-run shows the resolved rows gone

## Implementation Notes

Opportunistic. Do not bundle with feature work. Each duplicate pair can be its own small PR.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/components/recipe-detail/index.ts`
  - the listed duplicate pairs
  - `scripts/audit-scanners.ts (cap reporting only)`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- CameraView platform split may be intentional — confirm before merging the two files.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (L17, SCAN-KNIP-13, SCAN-JSCPD, SCAN-FLEN).
