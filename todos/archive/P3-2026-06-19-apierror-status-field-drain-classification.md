---
title: "Add ApiError.status and branch offline-drain retry classification on it (not message regex)"
status: done
priority: low
created: 2026-06-19
updated: 2026-06-19
assignee:
labels: [deferred, client-state]
github_issue:
---

# Add ApiError.status and branch offline-drain retry classification on it

## Summary

The offline drain classifies failures by regex on `error.message`
(`/^4\d\d:/`, `/network request failed/i`). It is functionally correct today
(matches `apiRequest`'s `"${status}: ${text}"` shape) but fragile: a change to the
message format would silently break the 4xx-vs-5xx-vs-network retry budgeting.

## Background

Finding L4 of the 2026-06-19 full audit (code-quality). `ApiError`
(`client/lib/api-error.ts`) carries `code?: string` and `message` but no numeric
`.status`, so message-regex is the only way to recover the HTTP status class.
Deferred because it touches the shared `ApiError` shape + `throwIfResNotOk`, a
broader change than the audit's offline-feature scope.

Note: this is NOT a `no-error-message-in-ui` violation — `error.message` is used
only for control flow; the user-facing copy is static.

## Acceptance Criteria

- [ ] `ApiError` exposes a numeric `status?: number`, set in `throwIfResNotOk`.
- [ ] `offline-queue-drain.ts` branches on `error.status` (4xx vs 5xx) and a typed
      network-error check instead of `error.message` regexes.
- [ ] The M1 idempotent-DELETE-404 case (treat 404 on DELETE as success) is
      re-expressed via `status === 404` and stays covered by its test.
- [ ] Existing drain tests updated to the new shape; all green.

## Implementation Notes

- `client/lib/api-error.ts`, `client/lib/query-client.ts` (`throwIfResNotOk`).
- `client/lib/offline-queue-drain.ts:71,78` — the two regexes.
- `client/lib/__tests__/offline-queue-drain.test.ts` — the 404/4xx/5xx/network tests.
