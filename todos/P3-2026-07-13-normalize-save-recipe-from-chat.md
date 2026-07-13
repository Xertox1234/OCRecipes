<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "saveRecipeFromChat persists un-normalized recipes to communityRecipes"
status: backlog
priority: low
created: 2026-07-13
updated: 2026-07-13
assignee:
labels: [deferred, server]
github_issue:

---

# saveRecipeFromChat persists un-normalized recipes to communityRecipes

## Summary

`server/storage/recipe-from-chat.ts:101` (`saveRecipeFromChat`) inserts a user-saved
chat-generated recipe into `communityRecipes` without running it through
`normalizeRecipeFields` — title casing, difficulty labels, and unit standardization are
skipped, unlike every other write path into this table.

## Background

Found during the final whole-branch review of the paste-text-import +
normalize-all-imports branch (`docs/superpowers/plans/2026-07-13-paste-text-import-and-normalization.md`).
That branch centralized normalization into `createRecipeWithLimitCheck` (Task 6) and
`createCommunityRecipe` (dev-seed-only, already normalized-equivalent via seed data
shape), but `saveRecipeFromChat` is a separate, independent insert path the branch's
scope never enumerated — it saves an AI chat-generated recipe a user chose to keep, not
an "imported" or "hand-typed" recipe per the original feature request's literal wording.

Because `communityRecipes.ingredients` is JSONB with no format constraint, this is a
cosmetic/consistency gap only — no crash risk (contrast with the sibling finding about
`createMealPlanFromSuggestions`, which is a genuine crash risk on a `decimal` column and
was surfaced separately, not auto-filed as low-severity).

## Acceptance Criteria

- [ ] `saveRecipeFromChat` calls `normalizeRecipeFields` on title/description/difficulty/
      instructions/ingredients before inserting, matching the pattern already used in
      `createRecipeWithLimitCheck` (`server/storage/community-recipes.ts`)
- [ ] Existing tests for `saveRecipeFromChat` still pass; add a normalization assertion
      (e.g. lowercase title input → Title Case output) if none exists

## Implementation Notes

- File: `server/storage/recipe-from-chat.ts:101`
- Reference implementation: `server/storage/community-recipes.ts`'s
  `createRecipeWithLimitCheck` (Task 6 of the paste-text-import plan) — same target
  table, same normalization call shape, no decimal-coercion step needed (JSONB, not a
  nullable decimal column).

## Dependencies

- None — independent of the paste-text-import branch, which is already merged/mergeable
  without this fix.

## Risks

- Low — cosmetic only, no data-integrity or crash risk.

## Updates

### 2026-07-13

- Filed from final whole-branch review finding on the paste-text-import-normalization
  branch (opus reviewer, "Completeness Check: Normalization Coverage" section).
