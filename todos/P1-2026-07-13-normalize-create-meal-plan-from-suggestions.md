<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "createMealPlanFromSuggestions can crash on a fraction ingredient quantity"
status: backlog
priority: high
created: 2026-07-13
updated: 2026-07-13
assignee:
labels: [bug, server, reliability]
github_issue:

---

# createMealPlanFromSuggestions can crash on a fraction ingredient quantity

## Summary

`createMealPlanFromSuggestions` (`server/storage/meal-plan-recipes-crud.ts:199-217`)
inserts AI-generated meal-plan-suggestion ingredients straight into
`recipeIngredients.quantity` — a `decimal(10,2)` Postgres column — with no
normalization or decimal coercion. A quantity string like `"1/2"` or `"½"` will fail
the insert with `invalid input syntax for type numeric`, a live 500 on the
`POST /api/meal-plan/save-generated` path.

## Background

Found during the final whole-branch review of the paste-text-import +
normalize-all-imports branch (`docs/superpowers/plans/2026-07-13-paste-text-import-and-normalization.md`).
That branch fixed the identical bug class for the sibling function
`createMealPlanRecipe` (Task 4): fraction/unicode quantities are normalized via
`normalizeRecipeFields`/`normalizeIngredient`, then coerced to `null` if still not a
clean decimal string, via a local `DECIMAL_QUANTITY_RE` check — so an unparseable
quantity degrades to `null` instead of crashing the insert.

`createMealPlanFromSuggestions` writes the same table via the same transaction pattern
but was never in that plan's scope (it's an AI-suggestion save path, not an "imported"
or "hand-typed" recipe per the original feature request's literal wording) — the
reviewing agent explicitly recommended NOT widening that branch's scope to include this
fix, and filing it separately instead.

**Reachability:** not yet independently verified whether AI-generated meal-plan
suggestions realistically produce fraction-formatted quantity strings (vs. always
emitting clean decimals from the generation prompt) — worth confirming as the first
step of implementation, since it affects how urgently this should be picked up.

## Acceptance Criteria

- [ ] Confirm reachability: check `POST /api/meal-plan/save-generated`'s request schema
      (`server/routes/meal-plan.ts:694`, `z.coerce.string().optional().nullable()` — no
      format constraint) and the AI-generation prompt/service that produces suggestion
      ingredients, to determine whether fraction-formatted quantities are a realistic
      output shape today
- [ ] `createMealPlanFromSuggestions` normalizes ingredient name/unit via
      `normalizeRecipeFields`/`normalizeIngredient`, matching `createMealPlanRecipe`'s
      pattern
- [ ] Quantity gets the same `DECIMAL_QUANTITY_RE`-gated null-coercion as
      `createMealPlanRecipe` (Task 4) — an unparseable quantity stores `null`, never
      crashes the insert
- [ ] A test reproducing the crash (fraction quantity input) is added and passes after
      the fix — mirror the pattern from `createMealPlanRecipe`'s Task 4 tests in
      `server/storage/__tests__/meal-plan-recipes.test.ts`

## Implementation Notes

- File: `server/storage/meal-plan-recipes-crud.ts:199-217`
  (`createMealPlanFromSuggestions`)
- Reference/fix template: `createMealPlanRecipe` in the same file (added by Task 4 of
  the paste-text-import plan) — same `DECIMAL_QUANTITY_RE` local constant, same
  caller-local null-coercion rationale (this function also targets the nullable
  `decimal(10,2)` `recipeIngredients.quantity` column, same as `createMealPlanRecipe`,
  unlike `communityRecipes.ingredients`' non-nullable JSONB).
- Route that feeds this function: `POST /api/meal-plan/save-generated`
  (`server/routes/meal-plan.ts:694`).

## Dependencies

- None — independent of the paste-text-import branch, which does not need this fix to
  merge.

## Risks

- Live crash risk (500) on a code path already in production if AI-generated
  suggestions can produce fraction-formatted quantities — reachability should be
  confirmed early to gauge true urgency.

## Updates

### 2026-07-13

- Filed from final whole-branch review finding on the paste-text-import-normalization
  branch (opus reviewer, "Completeness Check: Normalization Coverage" section). User
  chose to file rather than widen that branch's scope.
