---
title: "Harden consent-timestamp storage signature (CCPA/PIPEDA defense-in-depth)"
status: done
priority: medium
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [deferred, security, database]
github_issue:
---

# Harden consent-timestamp storage signature

## Summary

Change `updateUserProfile` and `upsertProfileWithOnboarding` so the
`healthDataConsentAt` value is generated internally from `new Date()` —
not passed in by callers. Eliminates a footgun where a future internal
caller could supply a backdated Date for the initial consent stamp.

## Background

PR #119 added the CCPA/PIPEDA health-data consent flow with three layers
of protection against client-side timestamp manipulation:

1. Zod `.omit()` drops client-supplied values
2. Route only sets `new Date()` server-side
3. Storage uses `COALESCE` (and existence guard) to prevent overwrite

Layer 3 protects against **re-writes**, but the **initial** write is still
caller-controlled — the storage function accepts an arbitrary `Date`.
The current routes never forward client input there, so this is not an
exploitable bug today. But the signature is footgun-prone: a future
caller (an internal service, a script, a new route) could accidentally
pass user input through.

kimi-review surfaced this as CRITICAL during the PR #119 merge cycle on
2026-05-11. Triage: precautionary, not exploitable in current code.

## Acceptance Criteria

- [ ] `updateUserProfile`'s `UpdatableProfileFields` type omits
      `healthDataConsentAt`
- [ ] `updateUserProfile` accepts a `recordConsent?: boolean` parameter
      (or similar) instead; generates `new Date()` internally only when
      the flag is true
- [ ] `upsertProfileWithOnboarding` receives the same treatment
- [ ] `server/routes/profile.ts` POST + PUT switch from passing
      `healthDataConsentAt: new Date()` to passing `recordConsent: true`
- [ ] Storage tests in `server/storage/__tests__/users.test.ts` update
      their assertions: replace `healthDataConsentAt: new Date(...)`
      arguments with the boolean flag, and verify that calling with
      `recordConsent: true` stamps a Date within the request window
- [ ] Append-only behavior (COALESCE / existence guard) still tested
      and passes
- [ ] Pattern doc `docs/patterns/security.md` "Server-Stamped, Append-Only
      Consent / Audit Timestamps" updated to reflect the new signature

## Implementation Notes

- Touch points (read carefully — they're load-bearing for compliance):
  - `server/storage/users.ts` — `updateUserProfile`, `upsertProfileWithOnboarding`,
    `UpdatableProfileFields` type
  - `server/routes/profile.ts` — POST + PUT handlers
  - `server/storage/__tests__/users.test.ts` — three consent tests added
    in PR #119
  - `docs/patterns/security.md` — code examples
- After the refactor, the storage function signature becomes the **first**
  line of defense (impossible to misuse), with COALESCE/existence guard
  as the durable enforcement point.
- Watch for any other caller of `updateUserProfile` that previously
  passed `healthDataConsentAt` — currently only the route layer does,
  but grep before refactoring to be sure.

## Dependencies

None — this is a self-contained hardening refactor of code merged in PR #119.

## Risks

- Test churn: the three new tests in `users.test.ts` need their
  assertions rewritten (they pass a Date today; they'll pass a boolean
  after).
- The pattern doc currently shows the "incoming Date" version — must
  be updated in lockstep or it becomes misleading for future consent
  features (terms acceptance, age verification).
