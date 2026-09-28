---
title: "Recipe finder: #1151 review follow-ups to fix BEFORE RECIPE_FINDER_ENABLED is flipped"
status: backlog
priority: medium
created: 2026-09-28
updated: 2026-09-28
assignee:
labels: [deferred, ai-prompting]
github_issue:
---

# Recipe finder pre-flip review follow-ups (#1151)

## Summary

These are the non-blocking findings from #1151's four-reviewer pass (the CRITICAL refund bypass was fixed on that branch). All of them need the flag on to happen, and **all must be fixed before PR D flips `RECIPE_FINDER_ENABLED`**.

## Findings

1. **Coach action requests routed to the finder** (ai-reviewer; measured 26/26 routed). `recipe_verb` in `server/services/coach-intent-classifier.ts` matches "I want to add this recipe to my meal plan", "I need a substitute for eggs in my recipe" and "give me the calories in that recipe". The exclusion only covers log/save/delete/track, so lookup_nutrition, add_to_meal_plan, add_to_grocery_list and get_substitutions never run for those messages.
2. **Malformed Spoonacular 200 reads as "no matches"** (code-reviewer; measured: `{"status":"failure","code":401}` → `{status:"ok",items:[]}`). `searchCatalogRecipes` turns a schema-parse failure (and a key missing at module load) into an empty list, so `findOnline` cannot tell it from a genuine empty result.
3. **A whitespace-only request leaves a dead list** (code-reviewer; measured). `"   "` passes `min(1)` and is sanitized to `""`. The start step then stores `flow.request: ""`, which its own `finderFlowSchema` rejects on read, so every button on that list ends quietly.
4. **A user-initiated `DELETE /api/chat/messages/:id` erases claim markers** (server-reviewer). The H6 refund is now guarded (`deleteUnclaimedChatMessage`), but the user-facing delete is not. This is the same property the legacy daily limits already have, but D9's per-user cap was specified as the real bound.

5. **A claimed round-1 fall-through Generate can be lost on disconnect** (server-reviewer confirmation pass on 5150b436; probe). `runCoachFinderTurn` yields "Creating your recipe…" AFTER `executeFinderStep` has claimed the generation. The route's `if (aborted) break` returns the generator at that yield, so nothing is generated or persisted. The guarded refund keeps the claim, so there is no bypass, but the user loses a slot with no recipe, and the coach-turn.ts docblock ("always finishes and persists") is false on this path.

## Acceptance Criteria

- [x] (1) Add a demonstrative/possessive-referent exclusion (`this|that|my recipe`) or widen the exclusion verbs (add/put/substitute/swap/calories/macros). The routed examples above become must-NOT-route cases, and the 5/41 eval count is re-measured.
- [x] (2) Add an opt-in strict mode on `searchCatalogRecipes`, used only by `findOnline`, that throws on a parse failure or a missing key. Add a find-online test that drives a real malformed 200 through a stubbed `fetch`.
- [x] (3) Return 400 for an empty sanitized message before any finder row is written, and/or `finderBlockSchema.parse` the block in `executeFinderStep` before persisting.
- [x] (5) No yield between a claim and its persist in `runCoachFinderTurn` (drop or move the post-claim status). Add a test that `return()`s the generator at each post-claim yield and asserts the assistant row was persisted. Make the docblock true.
- [ ] (4) The user-facing message delete keeps claimed rows (or claims move to a small usage table that chat deletes cannot touch). Covered by a real-DB test.

## Implementation Notes

- Files: `server/services/coach-intent-classifier.ts`, `server/services/recipe-catalog.ts`, `server/services/recipe-finder/find-online.ts`, `server/routes/chat.ts`, `server/services/recipe-finder/run-turn.ts`, `server/storage/chat.ts` / `server/storage/chat-quota.ts`.

## Dependencies

- #1151 merged.

## Updates

### 2026-09-28

- Filed from #1151's review (one review pass; non-blocking findings go to a follow-up).
- Items 1, 2, 3, 5 fixed on `fix/recipe-finder-pre-flip-followups`. Item 3 is a 400 only: `sanitizedContent` is the only path to an empty `flow.request` (answers are `min(1)`; `appendToRequest` extends a non-empty base).
- Item 4 split to its own PR: deleting a CONVERSATION cascades to its messages and erases claim markers too, so a message-delete guard is not enough. It needs a claims table with no conversation FK (migration). Still required before the flag flip.
