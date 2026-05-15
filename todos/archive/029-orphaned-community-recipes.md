---
title: "Handle orphaned community recipes after author deletion"
status: backlog
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [data-integrity, audit-2026-03-27-full]
audit_id: L9
---

# Handle orphaned community recipes after author deletion

## Summary

`shared/schema.ts:432-434` uses `onDelete: "set null"` for `communityRecipes.authorId`, but `deleteCommunityRecipe` filters by `eq(authorId, authorId)`. When authorId is NULL (user deleted), recipes become permanently undeletable via the API.

## Acceptance Criteria

- [ ] Admin can delete orphaned recipes (authorId IS NULL)
- [ ] Or: add a cleanup job that handles orphaned recipes
- [ ] Or: change delete logic to allow deletion when authorId is NULL (with appropriate auth check)

## Implementation Notes

- Simplest fix: add an admin endpoint or modify the delete function to handle NULL authorId

## Dependencies

- None

## Risks

- None

## Updates

### 2026-03-27

- Created from full audit finding L9
