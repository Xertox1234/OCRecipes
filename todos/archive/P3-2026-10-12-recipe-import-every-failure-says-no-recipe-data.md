---
title: "Recipe URL import: every failure says 'No recipe data found'"
status: done
priority: low
created: 2026-10-12
updated: 2026-10-17
assignee:
labels: [deferred, ui]
github_issue:
---

# Recipe URL import: every failure says "No recipe data found"

## Summary

The URL import error screen shows "No recipe data found on this page." for every failure, including a link that can't be reached, a timeout, or a page that's too big. The user can't tell a typo in the link from a page with no recipe on it.

## Background

Found while checking QA finding #15 on the simulator (2026-10-12). `https://nope.invalid/r` does not resolve (`ENOTFOUND`), so the server returns `FETCH_FAILED`. The screen still said "No recipe data found on this page."

Cause: `server/routes/recipe-import.ts` sends every import failure as HTTP 422 (`sendError(res, 422, messages[result.error] …, code)`). `client/screens/meal-plan/RecipeImportScreen.tsx:86` checks `msg.includes("422") || msg.includes("NO_RECIPE_DATA")` first, so the `FETCH_FAILED` branch below it never runs. `TIMEOUT` and `RESPONSE_TOO_LARGE` have no client copy at all.

Not one of the sweep findings, so it was left out of the accessibility todo's PR.

## Acceptance Criteria

- [x] The error screen picks its copy from the server's error code (`ApiError.code`), not from "422" in the message.
- [x] Unreachable link, timeout, too-large page, and no-recipe page each show their own message.
- [x] A test covers at least the unreachable-link and no-recipe cases.

## Implementation Notes

- `client/screens/meal-plan/RecipeImportScreen.tsx:81-95` (catch block). `client/lib/api-error.ts` already carries `code`.
- Server messages live in `server/routes/recipe-import.ts:30-40` (`FETCH_FAILED: "Could not fetch the URL"`, `TIMEOUT`, `RESPONSE_TOO_LARGE`).
- The photo/text import routes in the same file send 422 the same way; check their screens use the code too.

## Updates

### 2026-10-12

- Filed while verifying #15 on the simulator.

### 2026-10-17

- Implemented: `urlImportErrorCopy` (client/screens/meal-plan/recipe-import-utils.ts) keys copy on `ApiError.code`; added `TIMEOUT` to `ErrorCode`. Photo/text import screens already used `importErrorCopy` on `.code`.

### 2026-10-17

- Implemented: `urlImportErrorCopy` (client/screens/meal-plan/recipe-import-utils.ts) keys copy on `ApiError.code`; added `TIMEOUT` to `ErrorCode`. Photo/text import screens already used `importErrorCopy` on `.code`.
