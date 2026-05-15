---
title: "Add storage-layer ownership enforcement to addRecipeToCookbook / removeRecipeFromCookbook"
status: backlog
priority: medium
created: 2026-05-15
updated: 2026-05-15
assignee:
labels: [security, deferred, defense-in-depth]
github_issue:
---

# Add storage-layer ownership enforcement to addRecipeToCookbook / removeRecipeFromCookbook

## Summary

`server/storage/cookbooks.ts` exports `addRecipeToCookbook(cookbookId, recipeId, recipeType)` and `removeRecipeFromCookbook(cookbookId, recipeId, recipeType)` without a `userId` parameter. Ownership is enforced only at the route layer (`server/routes/cookbooks.ts` calls `getCookbook(id, userId)` first). `docs/patterns/security.md` → "Storage-Layer Defense-in-Depth" (line 103) recommends pushing the ownership filter into the storage SQL itself.

## Background

Surfaced by `kimi-review` during execution of `todos/archive/2026-05-11-storage-tests-medium.md`. Reviewer flagged it as CRITICAL but it was triaged as out-of-scope for that test-coverage todo: changing the signature requires touching every call site (routes, services, scripts) and migrating their tests, which is a separate refactor.

## Acceptance Criteria

- [ ] `addRecipeToCookbook` accepts a `userId` parameter and refuses to insert when the cookbook is not owned by that user (use an `innerJoin` on `cookbooks` or a `WHERE EXISTS (...)` guard in the same statement, not a separate SELECT).
- [ ] `removeRecipeFromCookbook` accepts a `userId` parameter with the same guard.
- [ ] All call sites (`server/routes/cookbooks.ts`, any seed/admin script) pass `userId`.
- [ ] `server/storage/__tests__/cookbooks.test.ts` adds negative IDOR tests for both mutations.
- [ ] Route tests in `server/routes/__tests__/cookbooks.test.ts` continue to pass without modification (route guard is now defense-in-depth, not the sole gate).

## Implementation Notes

- Follow the pattern at `docs/patterns/security.md` line 230 ("Lightweight Ownership Verification for Mutations").
- For `addRecipeToCookbook`, the current implementation already uses `db.transaction()` — inside the transaction, first verify ownership with a lightweight `SELECT 1 FROM cookbooks WHERE id = ? AND user_id = ?` and short-circuit to `undefined` if no row.
- For `removeRecipeFromCookbook`, an `innerJoin` + `where` on `cookbooks.userId` is the cleanest form.

## Dependencies

- None.

## Risks

- Low — net-additive security check. Route-layer guard remains as primary gate; storage guard is defense-in-depth.

## Updates

### 2026-05-15

- Created as follow-up to `todos/archive/2026-05-11-storage-tests-medium.md`; kimi-review flagged the missing storage-layer check during that todo but it was out of scope.
