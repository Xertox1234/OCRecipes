---
title: "Close residual microtask-gap TOCTOU in offline-queue drain by pinning the bearer token"
status: blocked
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

- [ ] `attemptDrain` captures the token once (it already does for the re-check)
      and passes it to `apiRequest` as a pinned `Authorization` bearer, so the
      request dispatches under the exact token validated by the re-check — never
      a token re-read at dispatch time.
- [ ] If pinning is threaded through `apiRequest`, the change is backward
      compatible for all other callers (optional override param; default behavior
      unchanged).
- [ ] A deterministic test asserts the dispatched request carries the captured
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

### 2026-06-20 (blocked — already implemented in OPEN PR #417)

- Set `status: blocked`. A prior `/todo` session already implemented this exact
  fix in OPEN PR #417 ("fix: pin captured bearer through apiRequest to close
  offline-drain microtask TOCTOU"): `apiRequest` gains an optional
  `authToken?: string | null` (defaults to `tokenStorage.get()`; pinned value
  used verbatim when provided), and `attemptDrain` passes the post-wait-validated
  token. CI is green on every correctness gate (Lint·Types·Patterns, all 3 test
  shards, Coverage, CodeQL, Mutation); only the "Solutions-DB gates" check fails
  and the branch is stale-behind-main (cut at 309797a0). Do NOT re-implement —
  review/land PR #417 instead. **Archive this todo when #417 merges.**
