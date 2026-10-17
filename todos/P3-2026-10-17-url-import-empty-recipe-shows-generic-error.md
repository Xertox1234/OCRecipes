---
title: "URL import: a recipe with no ingredients or instructions shows 'Something went wrong'"
status: in-progress
priority: low
created: 2026-10-17
updated: 2026-10-17
assignee:
labels: [deferred, ui]
github_issue:
---

# URL import: a recipe with no ingredients or instructions shows "Something went wrong"

## Summary

When a page has recipe markup but no ingredients and no instructions, the import screen now says "Something went wrong. Please try again." It should say there's no recipe on the page.

## Background

Found while reviewing PR #1482, which made the URL import screen pick its message from `ApiError.code` instead of matching "422" in the message text. The server's empty-recipe check in `server/routes/recipe-import.ts` (both URL routes, the "This recipe has no instructions or ingredients" `sendError(res, 422, …, ErrorCode.VALIDATION_ERROR)`) uses `VALIDATION_ERROR`. Before #1482 the `"422"` match turned it into "No recipe data found on this page."; now it falls to the generic message. The client cannot remap `VALIDATION_ERROR`, because the 400 invalid-URL response uses the same code.

Deferred instead of added to #1482 because that PR had already been reviewed and had auto-merge armed (one review pass per PR).

## Acceptance Criteria

- [ ] The empty-recipe check in both URL routes sends `ErrorCode.NO_RECIPE_DATA` (keep HTTP 422).
- [ ] Importing such a page shows "No recipe data found on this page."
- [ ] A route test asserts the `NO_RECIPE_DATA` code for a parsed recipe with no ingredients and no instructions.

## Implementation Notes

- `server/routes/recipe-import.ts`: the two `"This recipe has no instructions or ingredients and cannot be imported"` `sendError` calls (parse-url ~L62, save ~L142).
- Client copy is already in `client/screens/meal-plan/recipe-import-utils.ts` (`urlImportErrorCopy`, added in #1482). No client change needed.
- Check `server/routes/__tests__/` for an existing recipe-import route test and any assertion on `VALIDATION_ERROR` for this case.

## Updates

### 2026-10-17

- Filed while reviewing #1482.
