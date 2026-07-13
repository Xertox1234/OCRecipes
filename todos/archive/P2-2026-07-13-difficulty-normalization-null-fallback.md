<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "normalizeDifficulty silently nulls out an unmapped difficulty string instead of preserving it"
status: done
priority: medium
created: 2026-07-13
updated: 2026-07-13
assignee:
labels: [bug, server]
github_issue:

---

# normalizeDifficulty silently nulls out an unmapped difficulty string instead of preserving it

## Summary

Two `communityRecipes` insert paths store `normalized.difficulty` with no `?? raw`
fallback, unlike the sibling `title`/`instructions`/`ingredients` fields in the same
functions. `normalizeDifficulty` (`server/lib/recipe-normalization.ts:67-72`) maps only 10
known synonyms to `"Easy"`/`"Medium"`/`"Hard"` and returns `null` for anything else — so a
difficulty value the AI produces outside that vocabulary is silently discarded instead of
being stored verbatim.

## Background

Surfaced during multi-angle code review of PR #613 (normalize recipes saved from chat).
Four of eight independent review angles converged on this same finding:

- `server/storage/recipe-from-chat.ts:127` — `difficulty: normalized.difficulty,` (added
  in #613, mirrors the pattern below rather than introducing it)
- `server/storage/community-recipes.ts:108-109` — `createRecipeWithLimitCheck`, the
  existing reference implementation PR #613 was built to match. This bare-no-fallback
  pattern already shipped here; PR #613 just replicated it into the second call site.

Deliberately NOT fixed as part of #613: the plan for that PR explicitly called this out as
an accepted, intentional consequence of matching the reference implementation's existing
behavior — the goal of that PR was parity with `createRecipeWithLimitCheck`, not
introducing new fallback behavior. Fixing it belongs to a change that touches both
call sites together, which is genuinely out of scope for a "make X match Y" fix.

In practice, the blast radius may be narrow: `server/services/recipe-chat.ts` and
`server/services/recipe-generation.ts` both constrain the LLM's difficulty output via
`z.enum(["Easy", "Medium", "Hard"])` at generation time, so normally-generated recipes
should already produce a mappable value. The risk is legacy chat metadata (predates the
enum), a remix's `originalRecipe.difficulty` carrying forward an already-off-vocabulary
value, or any future metadata producer that doesn't route through the enum-constrained
services — `recipeChatMetadataSchema.recipe.difficulty` (the schema `saveRecipeFromChat`
actually validates against) is an unconstrained `z.string()`, not the enum, so nothing at
the storage layer actually guarantees the enum-only invariant holds.

Several UI surfaces gate a difficulty badge on truthiness (`RecipeMetaChips.tsx`,
`MealSuggestionsModal.tsx`, `SavedItemCard.tsx`, `CookbookDetailScreen.tsx`,
`FavouriteRecipesScreen.tsx`), so a `null` where a real (if unmapped) string used to be
stored means "difficulty" quietly disappears from those cards for the affected recipe.

## Acceptance Criteria

- [ ] Decide the intended behavior for an unmapped difficulty: preserve the raw string
      (`?? data.difficulty` fallback, matching `title`/`instructions`/`ingredients`) vs.
      keep discarding it as `null` but make that an explicit, documented choice (and
      confirm no UI surface needs a non-null value to render correctly).
- [ ] Apply the same fix to BOTH call sites together — `server/storage/recipe-from-chat.ts`
      and `server/storage/community-recipes.ts` (`createRecipeWithLimitCheck`) — so they
      don't drift apart again.
- [ ] Add a test covering the unmapped-difficulty case (e.g. `"Challenging"` or
      `"beginner-friendly"`) for at least one of the two call sites, asserting the chosen
      behavior explicitly (currently untested in both).

## Implementation Notes

- `server/lib/recipe-normalization.ts:67-72` (`normalizeDifficulty`) — the mapping table
  (`DIFFICULTY_MAP`) that returns `null` on no match.
- `server/storage/recipe-from-chat.ts:127` and `server/storage/community-recipes.ts:109`
  — the two call sites to update in lockstep if a fallback is chosen.
- Consider whether extracting a small shared `applyNormalizedRecipeFields(normalized, raw)`
  helper (returning `{title, description, difficulty, instructions, ingredients}` with a
  single, consistent fallback policy) is warranted now that there are two call sites with
  the identical normalize-then-map shape — flagged as a SUGGESTION-level cleanup by two
  review angles on PR #613 but not acted on there since 2 sites with an explicit
  cross-reference comment was judged acceptable at the time.

## Dependencies

- None — independent of PR #613, which is already merged/mergeable without this fix.

## Risks

- Narrow trigger surface in the current codebase (AI generation is enum-constrained), but
  the storage-layer schema does not itself enforce the enum, so this is a latent gap
  rather than a purely theoretical one.

## Updates

### 2026-07-13

- Filed after user asked "was this fixed?" following the PR #613 code review, which
  surfaced this as the most-repeated (4/8 angles) finding but left it unfixed by design
  (matches the accepted reference behavior). User requested a todo to look at it later.
