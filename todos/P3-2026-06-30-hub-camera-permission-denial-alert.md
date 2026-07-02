<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "RecipeEntryHubScreen lost its friendly camera-permission-denied alert"
status: backlog
priority: low
created: 2026-06-30
updated: 2026-06-30
assignee:
labels: [deferred, ui-ux, recipe-import]
github_issue:

---

# RecipeEntryHubScreen lost its friendly camera-permission-denied alert

## Summary

`RecipeEntryHubScreen`'s photo-import card used to show a friendly "enable camera access in Settings" `Alert` when the OS camera permission was denied. Now that this card opens the shared `ImportRecipeSheet`, its `handleCamera` relies on the bare OS permission prompt and silently no-ops on denial — no explanatory alert.

## Background

Surfaced during the Phase 1 recipe-import consolidation (`docs/superpowers/plans/2026-06-30-recipe-import-redesign.md`, Task 3), which collapsed `RecipeEntryHubScreen`'s two import cards into one that opens `ImportRecipeSheet`. The deleted `handlePhotoPress`/`launchCamera` functions (pre-Task-3) showed a friendly permission-denied `Alert` with a path to Settings; `ImportRecipeSheet.tsx`'s `handleCamera` does not have this — it's a UX regression inherited by every entry point that now routes through the shared sheet, not something Task 3 introduced deliberately. Flagged by Task 3's code reviewer as a Minor finding, correctly deferred rather than fixed inline (out of Task 3's file scope — the sheet is a Task 2 file).

## Acceptance Criteria

- [ ] `ImportRecipeSheet.tsx`'s `handleCamera` (and `handleGallery`, if it has the same gap) shows a clear, actionable message when the OS camera/library permission is denied — e.g. an `Alert` with a path to Settings, matching what `RecipeEntryHubScreen`'s old `launchCamera` did.
- [ ] Behavior verified consistent across every entry point that opens the shared sheet (Hub, Home tile, Home discovery card, QuickAddSheet, meal-slot action).
- [ ] Android: denial must not surface as an unhandled promise rejection — the app declares `CAMERA` in the manifest (VisionCamera), so `ImagePicker.launchCameraAsync` REJECTS on denial there (it does not silently no-op like iOS), and `void handlePremiumAction(async () => …)` has no catch. Wrap the launcher call (or `handlePremiumAction`) in a try/catch that feeds the same friendly alert. (Added 2026-07-02 from the phase1-v2 port review.)

## Implementation Notes

- Look at the pre-Task-3 version of `RecipeEntryHubScreen.tsx`'s `launchCamera` (git history, commit before `c9663a48`) for the exact alert copy/pattern to restore.
- This is UX polish on a permission-denial edge case, not a paywall/blocker — low severity.

## Dependencies

- None.

## Risks

- None significant — isolated to the permission-denial branch of `handleCamera`/`handleGallery`.

## Updates

### 2026-06-30

- Initial creation, filed during Phase 1 (recipe-import-redesign) Task 3 review.
