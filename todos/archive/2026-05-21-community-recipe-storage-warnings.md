---
title: "Triage community-recipe storage WARNINGs (visibility scoping, ambiguity, existence leak)"
status: done
priority: medium
created: 2026-05-21
updated: 2026-05-22
assignee:
labels: [security, database]
github_issue:
---

# Triage community-recipe storage WARNINGs

## Summary

Four WARNING-tier kimi-review findings on community-recipe storage reads,
grouped into one triage pass. All are judgment-based and pre-date the
storage-module split (moved byte-identical from `main`).

## Background

Surfaced by the diff-scoped kimi gate while reviewing the
`todo/2026-05-20-split-oversized-storage-modules` branch on 2026-05-21. Bundled
into a single todo per request — none is a blocker; each needs a "fix or
confirm-safe" decision. Functions live in `server/storage/community-recipes.ts`
post-split (`server/storage/community.ts` on `main`).

## Acceptance Criteria

- [x] `getCommunityRecipes` — confirm the barcode `or()` arm is visibility-scoped.
      Current code is `and(isPublic, or(barcode, nameMatch))`, which appears
      correctly scoped; verify no path escapes the `isPublic` guard, then close
      (or fix if a gap is real).
- [x] `getCommunityRecipeTitlesByIds` — the returned `Map` cannot distinguish
      "id not found" from "id exists but is not public"; both yield a missing
      entry. Decide whether callers need to tell these apart. (Overlaps with the
      CRITICAL todo's reassessment of the `isPublic` filter.)
- [x] `updateCommunityRecipeImageUrl` — no ownership check; relies on an
      `// idor-safe: internal background patcher` comment (recipeId from DB
      result, not user input). Confirm via LSP `findReferences` that no route
      passes a user-controlled `recipeId`; if the internal-only invariant ever
      breaks, add a guard.
- [x] `getCommunityRecipe` — existence-leak if exposed via routes (returning data
      vs. `undefined` reveals existence). Closes automatically if the CRITICAL
      todo lands first; otherwise address here.

## Implementation Notes

- These overlap heavily with
  `2026-05-21-community-recipe-read-visibility-scoping.md` (CRITICAL). Do that one
  first — several of these may close as a side-effect.
- Map call-sites with the LSP tool (warm with a throwaway `hover` first) before
  changing any storage behavior; exploitability is determined at the route
  boundary, not in the storage layer.

## Dependencies

- 2026-05-21-community-recipe-read-visibility-scoping.md (CRITICAL) — do first.
- Best done after `todo/2026-05-20-split-oversized-storage-modules` merges.

## Risks

- Low. Mostly verification; behavioral changes only where a real gap is confirmed.

## Security note

Security-domain — do NOT delegate to Copilot/Kimi. Implement and review directly.

## Updates

### 2026-05-21

- Created from grouped WARNING kimi-review findings surfaced during the
  storage-module split (`/todo` run).

### 2026-05-22

Triage complete — **verification-only closure, no source-code changes.** All four
WARNINGs confirmed safe at the route boundary. Evidence per AC
(`server/storage/community-recipes.ts`):

- **AC1 — `getCommunityRecipes` (lines 26-60):** the `or(barcode, nameMatch)`
  arm is pushed into the same `conditions` array as the unconditional
  `eq(isPublic, true)` and combined with `and(...conditions)`. The barcode arm
  cannot escape the `isPublic` guard. Test `"does not return private recipes"`
  (community.test.ts:171) proves a private barcode match returns 0 rows. No gap.
- **AC2 — `getCommunityRecipeTitlesByIds` (lines 450-471):** the not-found vs.
  not-public ambiguity is benign for the sole caller. PR #242 already removed the
  `isPublic` filter and re-scoped via an INNER JOIN through `recipe_dismissals`
  (the dismissal record is the authorization). The only caller,
  `server/routes/meal-suggestions.ts:165-167`, does
  `dismissedIds.map((id) => titlesMap.get(id)).filter(t => t !== undefined)` —
  missing entries are silently dropped from the dismissed-context prompt list,
  which is the intended behavior. No caller needs to distinguish the two cases.
- **AC3 — `updateCommunityRecipeImageUrl` (lines 162-170):** internal-only
  invariant holds. LSP `findReferences` + facade-grep show the single production
  call-site is `server/services/recipe-generation.ts:398` inside
  `generateAndPatchRecipeImage`, invoked fire-and-forget from
  `server/routes/recipes.ts:253` with `recipe.id` — the id of the row just
  created by `storage.createRecipeWithLimitCheck` (recipes.ts:216-235), not a
  user-supplied path/body param. No route passes a user-controlled `recipeId`.
  The `// idor-safe: internal background patcher` comment is accurate.
- **AC4 — `getCommunityRecipe` (lines 181-198):** closed by PR #242 (merged as
  #242, dependency todo `community-recipe-read-visibility-scoping`). Required
  `userId` param + SQL filter
  `id = ? AND (isPublic OR authorId = userId)` returns `undefined` for
  private-non-owned recipes (identical to a missing id → no existence leak).
  Covered by test `"returns undefined for a private recipe the user does not
own (no existence leak)"` (community.test.ts:276).
