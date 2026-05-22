---
title: "Scope community-recipe storage reads by visibility/ownership (2 CRITICAL findings)"
status: backlog
priority: high
created: 2026-05-21
updated: 2026-05-21
assignee:
labels: [security, database]
github_issue:
---

# Scope community-recipe storage reads by visibility/ownership

## Summary

Two CRITICAL security findings (kimi-review) flag community-recipe read functions
that do not scope results by visibility/ownership. Both pre-date the
storage-module split — verified byte-identical to `main`; the split only
relocated them into `server/storage/community-recipes.ts`.

## Background

Surfaced by the diff-scoped kimi gate while reviewing the
`todo/2026-05-20-split-oversized-storage-modules` branch on 2026-05-21. The
functions were moved verbatim, so these are pre-existing issues on `main`, not
regressions introduced by the split. The app has no production deployment yet,
so real-world exposure depends on which routes call these functions with
user-controlled input — audit call-sites before deciding the fix.

## Acceptance Criteria

- [ ] `getCommunityRecipe(id)` — audit every call-site (LSP `findReferences`). If
      any route passes a user-controlled `id`, add an `isPublic`/ownership filter
      so a user cannot fetch a recipe that is not public and not theirs. Return
      `undefined` for both "not found" and "not visible" (no existence leak).
- [ ] `getCommunityRecipeTitlesByIds(ids)` — reassess the `isPublic = true`
      filter. This function resolves titles for already-known ids (e.g. dismissed
      recipes fed back as prompt-injection context). Filtering on `isPublic`
      silently drops titles for recipes that were public when referenced but later
      made private, leaving the dismissed-context map incomplete. Decide whether a
      visibility filter belongs here at all; if not, remove it (or split into a
      visibility-checked browse variant vs. a plain id→title resolver).
- [ ] No behavioral change to legitimate public-recipe reads.
- [ ] Storage tests added/updated to cover the visibility/ownership cases.

## Implementation Notes

Current code (on `main`: `server/storage/community.ts`; post-split:
`server/storage/community-recipes.ts` — reference by function name, line numbers
shift):

`getCommunityRecipe`:

```
SELECT * FROM communityRecipes WHERE id = ?      -- no isPublic, no owner filter
```

`getCommunityRecipeTitlesByIds`:

```
SELECT id, title FROM communityRecipes
WHERE id IN (...) AND isPublic = true             -- drops now-private titles
```

- Start by mapping call-sites with the LSP tool (warm it with a throwaway `hover`
  first — the first `findReferences` of a session is unreliable). The correct fix
  depends entirely on whether ids are user-controlled at the route boundary.
- The WARNING about an existence-leak on `getCommunityRecipe` is covered by the
  first criterion's "return undefined for both cases" requirement.

## Dependencies

- Best done AFTER `todo/2026-05-20-split-oversized-storage-modules` merges, so the
  fix lands in `community-recipes.ts` rather than colliding with the split.

## Risks

- Over-scoping could break legitimate internal reads. `updateCommunityRecipeImageUrl`
  documents an "internal background patcher" pattern (recipeId from DB result, not
  user input) — distinguish internal-only reads from user-facing ones before
  tightening anything.

## Security note

Do NOT delegate to Copilot/Kimi. Per CLAUDE.md, security/permissions logic is
never delegated — implement and review directly.

## Updates

### 2026-05-21

- Created from CRITICAL kimi-review findings surfaced during the storage-module
  split (`/todo` run). Both findings verified pre-existing on `main` (functions
  moved byte-identical).
