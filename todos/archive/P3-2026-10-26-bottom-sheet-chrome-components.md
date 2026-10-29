---
title: "Share bottom-sheet header, drag handle and option row across the meal-plan sheets"
status: done
priority: low
created: 2026-10-26
updated: 2026-10-29
assignee:
labels: [deferred, maintainability, client]
github_issue:
---

# Share bottom-sheet header, drag handle and option row across the meal-plan sheets

## Summary

Drag handle, header + Done, and icon/title/description/chevron option rows are hand-repeated across four sheets; add one small chrome module.

## Background

Audit finding L6. QuickAddSheet ↔ SimpleEntrySheet and AddItemMenuSheet ↔ ImportRecipeSheet jscpd pairs; `AddItemMenuSheet.tsx:94-150` repeats the option row three times by hand; `dragIndicator` style appears in 6 files.

Deferred from the 2026-10-25 `/audit maintainability` run (user triage: the large refactors become todos, each its own PR with its own review). Discovery: `code-reviewer` with the maintainability-checklist lens; every cited line was re-read and grep-verified by the orchestrator before filing.

## Acceptance Criteria

- [x] `client/components/sheet/SheetChrome.tsx` exports `SheetDragHandle`, `SheetHeader({ title, onDone })`, `SheetOptionRow({ icon, title, description, onPress, accessibilityLabel })`
- [x] The four meal-plan sheets use it; each keeps its own `accessibilityViewIsModal` root and bottom-sheet wiring
- [x] Accessibility labels/roles identical before and after (snapshot the a11y props in tests)
- [x] Behaviour unchanged: existing tests for the touched files pass without edits to their assertions (new tests may be added)
- [x] No file in scope ends above 600 lines unless it started there and shrank

## Implementation Notes

Theme tokens only (`useTheme()`), no raw hex. 44pt touch targets. Do it as one bundle, not per pair.

## Scope Contract

- **Mechanisms to use:** extraction/move of existing code only — no new runtime behaviour
- **Files in scope:** `client/components/meal-plan/{QuickAddSheet,SimpleEntrySheet,AddItemMenuSheet,ImportRecipeSheet}.tsx`, new `client/components/sheet/SheetChrome.tsx`, their `__tests__`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- gorhom BottomSheet a11y: keep `accessible={false}` handling on the sheet root (see docs/solutions/logic-errors/gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md).

## Updates

### 2026-10-26

- Initial creation from the 2026-10-25 maintainability audit

### 2026-10-29

- Implemented: `SheetChrome.tsx` (`SheetDragHandle`, `SheetHeader`, `SheetOptionRow` with an optional `trailingIcon` for the premium lock) used by the four meal-plan sheets. Menu sheets use `SheetDragHandle` + `SheetOptionRow` and keep their own title line (their root already pads horizontally). QuickAddSheet 590 -> 545, SimpleEntrySheet 555 -> 508.
