---
title: "Shrink client/hooks/useAuth.ts below 600 lines"
status: done
priority: low
created: 2026-11-04
updated: 2026-11-06
assignee:
labels: [deferred, maintainability, auth]
github_issue:
human_led: true
blocked_reason: "Client sign-in/session code is never delegated (auth has a history of recurring breakage). Owner ruling 2026-11-04: do this in an interactive session, not an autonomous run."
---

# Shrink client/hooks/useAuth.ts below 600 lines

## Summary

`client/hooks/useAuth.ts` (~836 lines) is over the 600-line bar. Split it
without changing behaviour.

## Background

Split off on 2026-11-04 from
`todos/P2-2026-10-30-split-subscription-storage-out-of-users.md` (originally
filed from the 2026-10-30 iap-auth reliability PR review, which already moved
the push-token rotation effect into `client/hooks/usePushTokenRotation.ts`).
Human-led because it touches client token handling and session restore.

## Acceptance Criteria

- [x] `client/hooks/useAuth.ts` is under 600 lines (e.g. extract the
      cached-session restore and the `checkAuth` body into a sibling
      module/hook)
- [x] Existing tests in `client/hooks/__tests__/useAuth.test.ts` pass unchanged
      (move tests alongside if needed)

## Implementation Notes

- Pure move/refactor; no behaviour change.
- Files: `client/hooks/useAuth.ts`, a new sibling module under `client/hooks/`,
  `client/hooks/__tests__/useAuth.test.ts`.

## Scope Contract

- **Mechanisms to use:** extract functions/hooks; no new state or effects.
- **Files in scope:** the files listed above.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-04

- Split off from the storage todo (owner ruling 2026-11-04), human-led.

## Updates

### 2026-11-06

- Owner unlocked this human-led todo in the 2026-11-05 interactive /goal session. `useAuth.ts` 1001 → 514 lines: the module-level session plumbing and the `checkAuth` body moved verbatim to `client/hooks/auth-session.ts` (`runAuthCheck(setState)`), and the state-free account-security callbacks to `client/hooks/useAccountSecurityActions.ts`. `useAuth.ts` re-exports `AUTH_ME_TIMEOUT_MS` and the proof types, so no caller changed. `useAuth.test.ts` unchanged, 187/187 with the AuthContext tests.
