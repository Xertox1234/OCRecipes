---
title: "Remove dead post-apiRequest error branches in mutation hooks"
status: backlog
priority: low
created: 2026-05-17
updated: 2026-05-17
assignee:
labels: [deferred, client-state, testing, code-quality]
github_issue:
---

# Remove Dead Post-apiRequest Error Branches in Mutation Hooks

## Summary

`apiRequest()` throws on any non-2xx response (via `throwIfResNotOk`), so the
`if (!res.ok) { ... }` blocks that several hooks place _after_ awaiting
`apiRequest()` are unreachable dead code. Remove them and fix the test mocks
that hide the divergence.

## Background

`client/lib/query-client.ts` `apiRequest()` calls `throwIfResNotOk(res)` before
returning, so it never returns a non-ok `Response`. Yet `useMealSuggestions.ts`
and `useFavouriteRecipes.ts` both branch on `if (!res.ok)` / `res.status === 403`
_after_ `await apiRequest(...)` — branches that can never execute in production.

This was masked because the hook tests mock `apiRequest` to _resolve_ with an
`{ ok: false, status }` object instead of throwing — a mock/prod divergence (see
`useMealSuggestions.test.ts`). The tests pass by exercising the dead branch.

The PR that introduced `ApiError` code propagation (`throwIfResNotOk` now throws
`ApiError` with the parsed `code`) makes the dead branches fully redundant: the
`ApiError` already carries the `code` the dead branches were trying to attach.
This todo is the follow-up cleanup; it is not required for correctness.

## Acceptance Criteria

- [ ] Remove the unreachable `if (!res.ok)` / `res.status === 403` blocks from
      `useMealSuggestions.ts` and `useFavouriteRecipes.ts`.
- [ ] Update `useMealSuggestions.test.ts` (and any sibling) so the `apiRequest`
      mock _rejects_ with an `ApiError` (matching production), not resolves with
      a non-ok object.
- [ ] Confirm consumers still detect the relevant codes: `MealSuggestionsModal`
      (`DAILY_LIMIT_REACHED`), any `useFavouriteRecipes` consumer (`LIMIT_REACHED`),
      and `ChatScreen` (`message.includes("DAILY_LIMIT_REACHED")`).
- [ ] Tests, types, and lint pass.

## Implementation Notes

Relevant files:

- `client/hooks/useMealSuggestions.ts`
- `client/hooks/useFavouriteRecipes.ts`
- `client/hooks/__tests__/useMealSuggestions.test.ts`
- `client/hooks/__tests__/useFavouriteRecipes.test.ts` (if it asserts the limit path)

`useFavouriteRecipes` currently re-throws a plain `Error("LIMIT_REACHED")` from
its dead branch — verify whether any consumer matches on `error.message` before
removing it. If a consumer relies on the message, migrate it to `error.code`
first.

## Dependencies

- Builds on the `ApiError` code-propagation change in `query-client.ts`.

## Risks

- A consumer matching the limit by `error.message` rather than `error.code`
  would silently break — audit consumers before deleting branches.

## Updates

### 2026-05-17

- Created during the root-cause fix for `apiRequest` swallowing error codes.
