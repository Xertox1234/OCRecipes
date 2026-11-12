---
title: "Community recipe delete removes its image without the shared-reference check"
status: backlog
priority: low
created: 2026-11-12
updated: 2026-11-12
assignee:
labels: [deferred, data-integrity]
github_issue:
---

# Community recipe delete removes its image without the shared-reference check

## Summary

Two places in `server/storage/community-recipes.ts` delete a recipe image from storage without
first asking whether another row still points at the same image. A meal-plan recipe that shares
the URL would lose its picture.

## Background

Found by the security audit of 2026-11-12 (finding L13, Low, data integrity). The comment in
`server/storage/account-images.ts:21-24` says every delete of a client-suppliable URL is filtered
through `filterUnreferencedImageUrls` first. The two community-recipe call sites
(`server/storage/community-recipes.ts:216-221` and `458-461`) call `deleteImage(…, "recipe")`
directly.

Community image URLs are server-generated (`server/routes/recipes.ts:223`), so a caller cannot
aim this at someone else's image; the effect is limited to a shared URL losing its picture. The
owner deferred it from the audit PR.

## Acceptance Criteria

- [ ] A failing test first: a community recipe and a meal-plan recipe share an image URL; deleting
      the community recipe must leave the image in place.
- [ ] Both call sites delete only URLs that `filterUnreferencedImageUrls` returns.
- [ ] The delete still happens inside storage, after the commit (owner ruling 2026-11-06: R2
      deletes stay in storage — do not move them to callers).

## Implementation Notes

- Check whether a community recipe's URL can in fact be shared today (for example when a
  community recipe is saved into a meal plan). If no path copies the URL, say so in the PR; the
  filter is still the documented rule.

## Scope Contract

- **Mechanisms to use:** the existing `filterUnreferencedImageUrls` helper.
- **Files in scope:** `server/storage/community-recipes.ts`, `server/storage/account-images.ts`
  (read only unless the helper needs a new table), their `__tests__/` files.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- The reference check runs a query per delete; keep it inside the existing after-commit step.

## Updates

### 2026-11-12

- Initial creation (security audit 2026-11-12, finding L13)
