---
title: "Triage community-recipe storage WARNINGs (visibility scoping, ambiguity, existence leak)"
status: backlog
priority: medium
created: 2026-05-21
updated: 2026-05-21
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

- [ ] `getCommunityRecipes` — confirm the barcode `or()` arm is visibility-scoped.
      Current code is `and(isPublic, or(barcode, nameMatch))`, which appears
      correctly scoped; verify no path escapes the `isPublic` guard, then close
      (or fix if a gap is real).
- [ ] `getCommunityRecipeTitlesByIds` — the returned `Map` cannot distinguish
      "id not found" from "id exists but is not public"; both yield a missing
      entry. Decide whether callers need to tell these apart. (Overlaps with the
      CRITICAL todo's reassessment of the `isPublic` filter.)
- [ ] `updateCommunityRecipeImageUrl` — no ownership check; relies on an
      `// idor-safe: internal background patcher` comment (recipeId from DB
      result, not user input). Confirm via LSP `findReferences` that no route
      passes a user-controlled `recipeId`; if the internal-only invariant ever
      breaks, add a guard.
- [ ] `getCommunityRecipe` — existence-leak if exposed via routes (returning data
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
