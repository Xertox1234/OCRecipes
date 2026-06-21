---
title: "Close residual microtask-gap TOCTOU in offline-queue drain by pinning the bearer token"
status: done
priority: low
created: 2026-06-20
updated: 2026-06-20
assignee:
labels: [deferred, security, react-native]
github_issue:
---

# Pin the bearer token through apiRequest to close the offline-drain microtask TOCTOU

## Summary

After PR #413 (gate offline drain on auth), a narrow time-of-check/time-of-use
gap remains between `attemptDrain`'s post-wait token re-check and the token read
that `apiRequest` performs at dispatch time. Pinning the captured token through
`apiRequest` as an explicit bearer would make the drain airtight.

## Background

Surfaced as an informational SUGGESTION during the security review of
`P3-2026-06-19-offline-drain-auth-gate-race` (merged as PR #413). That fix added
(1) an auth gate on `drainQueue` and (2) a captured-token + queue-membership
re-check immediately after the backoff `wait`, right before `apiRequest`. Both
reviewers confirmed **no realistic exploit path** because account teardown fully
awaits before any relogin, so the only remaining window is a microtask gap
between the re-check and `apiRequest`'s own dispatch-time `tokenStorage.get()`.

This is a defense-in-depth hardening, not a live defect — the merged fix already
closes the practical race.

## Acceptance Criteria

- [x] `attemptDrain` captures the token once (it already does for the re-check)
      and passes it to `apiRequest` as a pinned `Authorization` bearer, so the
      request dispatches under the exact token validated by the re-check — never
      a token re-read at dispatch time.
- [x] If pinning is threaded through `apiRequest`, the change is backward
      compatible for all other callers (optional override param; default behavior
      unchanged).
- [x] A deterministic test asserts the dispatched request carries the captured
      token even if `tokenStorage` is mutated in the microtask gap after the
      re-check (control the token storage; never a real-time timing test).

## Implementation Notes

- `client/lib/offline-queue-drain.ts` `attemptDrain` — the captured token from the
  post-wait re-check is the value to pin.
- `client/lib/queryClient.ts` (or wherever `apiRequest` reads the token) — add an
  optional explicit-bearer override param; default to the current
  `tokenStorage.get()` behavior when not provided.
- Keep the existing auth gate + re-check from PR #413 intact; this only removes
  the final re-read.

## Dependencies

- Builds on PR #413 (offline-drain auth gate), already merged to main.

## Risks

- Low — localized to the drain path + one optional `apiRequest` param. The main
  care point is not regressing the default token-read behavior for the many other
  `apiRequest` callers.

## Updates

### 2026-06-20

- Initial creation — deferred SUGGESTION from the PR #413 security review,
  surfaced in the 2026-06-20 `/todo` batch summary.

### 2026-06-20 (implemented inline — NEVER-delegate auth, done by orchestrator)

- Added an optional trailing `authToken?: string | null` override to
  `apiRequest` (`client/lib/query-client.ts`): `undefined` → read storage
  (unchanged for all ~50 callers), a string pins that bearer, `null` pins
  "no auth". `attemptDrain` (`client/lib/offline-queue-drain.ts`) now passes the
  re-check-validated `tokenAtStart` as the 5th arg, so dispatch never re-reads
  `tokenStorage` — closing the microtask TOCTOU.
- Tests: new `client/lib/__tests__/api-request-pinned-token.test.ts` (real
  `apiRequest`: pinned bearer honored + storage NOT read, `null` pins no-auth,
  omitted falls back to storage, and a 401-with-pinned-token still fires the
  session-expiry signal) + a new drain test asserting the 5th-arg pinning.
- Reviewed by `code-reviewer` + `security-auditor` (both PASS, no blocking
  issues). The 401-session-expiry contract test was added per their shared note.
- Branch `todo/offline-drain-token-pin`; PR #417 opened without auto-merge (auth).

### 2026-06-20 (branch synced with main; archived as done)

- A later `/todo` run found PR #417 already open and merged current `main` into
  the stale branch (cut at 309797a0, behind PR #404 + later todo housekeeping),
  resolving this todo to `status: done` here. Re-ran CI to clear the previously
  red "Solutions-DB gates" check (a staleness artifact — the branch touched no
  solutions/scripts/`.github`). PR #417 left for human review before merge.
