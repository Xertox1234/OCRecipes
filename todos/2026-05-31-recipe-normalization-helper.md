---
title: "Extract normalizeRecipeFields() helper — dedupe 5-tuple across 3 route files"
status: backlog
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, maintainability, api]
github_issue:
---

# Extract normalizeRecipeFields() helper

## Summary

The same five `recipe-normalization` functions (`normalizeTitle/Description/Difficulty/Instructions/Ingredient`) are imported and called in the same sequence across three route files (four call sites). Collapse into one `normalizeRecipeFields()` helper.

## Background

Found in the 2026-05-31 code-quality re-run (maintainability H3). Code-judo: extract-to-delete. Makes "what normalization a recipe-create path applies" grep-verifiable in one place instead of four, and removes the 5-import fan across routes.

## Acceptance Criteria

- [ ] Add `normalizeRecipeFields(data: { title; description?; difficulty?; instructions?; ingredients? })` to `server/lib/recipe-normalization.ts` returning the normalized fields (spread-friendly)
- [ ] Replace the 4 call sites: `meal-plan.ts:173-191`, `recipes.ts:193-211`, `recipe-import.ts:77-81` (parse-url) and `recipe-import.ts:152-163` (import-url)
- [ ] Remove the now-unnecessary 5-function imports from the three route files (keep only what each still uses)
- [ ] Behavior byte-identical (same normalization, same order); existing route tests pass

## Implementation Notes

- Keep the helper a pure function over a plain object — no Express/req coupling — so it's unit-testable.
- `recipe-import.ts` applies the sequence twice; both become single calls.

## Risks

- Low-medium — touches 3 route files but the transformation is mechanical. Confirm field-by-field that the extracted helper preserves the exact call order and optional-field handling.

## Updates

### 2026-05-31

- Filed from the 2026-05-31 code-quality re-run, manifest H3.
