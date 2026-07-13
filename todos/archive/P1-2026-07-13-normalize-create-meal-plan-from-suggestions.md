<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "createMealPlanFromSuggestions can crash on a fraction ingredient quantity"
status: done
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

- [x] Confirm reachability: check `POST /api/meal-plan/save-generated`'s request schema
      (`server/routes/meal-plan.ts:694`, `z.coerce.string().optional().nullable()` — no
      format constraint) and the AI-generation prompt/service that produces suggestion
      ingredients, to determine whether fraction-formatted quantities are a realistic
      output shape today
- [x] `createMealPlanFromSuggestions` normalizes ingredient name/unit via
      `normalizeRecipeFields`/`normalizeIngredient`, matching `createMealPlanRecipe`'s
      pattern
- [x] Quantity gets the same `DECIMAL_QUANTITY_RE`-gated null-coercion as
      `createMealPlanRecipe` (Task 4) — an unparseable quantity stores `null`, never
      crashes the insert
- [x] A test reproducing the crash (fraction quantity input) is added and passes after
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

### 2026-07-13 (implementation)

- **Reachability confirmed real.** `POST /api/meal-plan/save-generated`'s
  `mealSchema.ingredients[].quantity` (`server/routes/meal-plan.ts:694`) is
  `z.coerce.string().optional().nullable()` with no format constraint. The
  upstream AI-generation prompt (`server/services/pantry-meal-plan.ts`,
  `generateMealPlanFromPantry`) instructs the model to produce
  `ingredients (name, quantity, unit)` with no decimal-only constraint on
  `quantity` either in its Zod schema (`z.coerce.string()`) or its prompt
  text — a GPT-4o-class model is realistically free to emit
  fraction-formatted quantities (e.g. `"1/2 cup"` style measurements are
  common in recipe generation), so this was a live, reachable crash risk on
  `POST /api/meal-plan/save-generated`, not a theoretical one.
- Fixed by mirroring `createMealPlanRecipe`'s (Task 4) normalization
  pattern into `createMealPlanFromSuggestions`: ingredient name/unit run
  through `normalizeIngredient`, quantity is null-coerced via the existing
  `DECIMAL_QUANTITY_RE` when unparseable. Two tests added mirroring the
  sibling's Task 4 tests (fraction → decimal string; unparseable freeform
  text → `null`).
- Checked `saveRecipeFromChat` (`server/storage/recipe-from-chat.ts`) — it
  writes `communityRecipes`' JSONB `ingredients` column, not the decimal
  `recipeIngredients.quantity` column, so it is not a third at-risk call
  site; no further scope was found.
- Codify (Step 9) skipped: no `docs/solutions/` entry currently covers this
  crash class, but the fix is a straightforward mirror of an
  already-established in-repo pattern (`createMealPlanRecipe`), not a new
  gotcha — nothing new to codify.
- Reviewed by `code-reviewer` (no findings) and `server-reviewer` (no
  CRITICAL; one WARNING — `DECIMAL_QUANTITY_RE` has no digit-count upper
  bound, a pre-existing gap identical in both `createMealPlanRecipe` and
  this new call site, out of this todo's scope since it wasn't introduced
  here — deferred for human triage; two SUGGESTIONs, one applied inline
  (stale comment), one intentionally skipped (dedup refactor not worth it
  for 2 call sites, per project's anti-premature-abstraction convention)).
