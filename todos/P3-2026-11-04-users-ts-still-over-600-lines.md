---
title: "server/storage/users.ts is still ~905 lines after the subscription split"
status: backlog
priority: low
created: 2026-11-04
updated: 2026-11-04
assignee:
labels: [deferred, maintainability, auth]
github_issue:
human_led: true
blocked_reason: "The rest of users.ts is the auth/account sections (sign-in, lockout, sessions). Auth storage is never delegated; same ruling as todos/P3-2026-11-04-shrink-useauth-below-600-lines.md (owner, 2026-11-04)."
---

# server/storage/users.ts is still ~905 lines after the subscription split

## Summary

PR #1744 moved the subscription/transaction functions into
`server/storage/subscriptions.ts`, taking `server/storage/users.ts` from 1297
to ~905 lines. That is still over the 600-line bar (and over the 500-line
storage split rule in `docs/rules/architecture.md`).

## Background

Deferred finding from the 2026-11-04 `/todo` run
(`todos/archive/P2-2026-10-30-split-subscription-storage-out-of-users.md`).
`getSubscriptionStatus`, `getEffectiveTierForUser` and `updateSubscription`
stayed in `users.ts`. The reason: `server/storage/nutrition.ts` and
`server/storage/favourite-recipes.ts` import `getEffectiveTierForUser` from
`./users`, and those files were outside that todo's Scope Contract. The rest
of the file is the profile and auth/account sections.

## Acceptance Criteria

- [ ] `server/storage/users.ts` is under 600 lines, split by sub-domain behind
      the existing `server/storage/index.ts` facade with no caller change
- [ ] Sub-modules import shared symbols from the sibling that defines them,
      never from the barrel (`docs/rules/architecture.md`)
- [ ] Existing tests pass unchanged (move tests alongside if needed)

## Implementation Notes

- Pure move, no behaviour change. Verify each moved block is byte-identical to
  `main` (`git show main:server/storage/users.ts`).
- Candidate split: tier/subscription-status reads (`getSubscriptionStatus`,
  `getEffectiveTierForUser`, `updateSubscription`) next to
  `server/storage/subscriptions.ts`, updating the `./users` imports in
  `server/storage/nutrition.ts` and `server/storage/favourite-recipes.ts`; then
  profile vs auth/account sections.
- Files: `server/storage/users.ts`, `server/storage/index.ts`, the new
  sub-module(s), `server/storage/nutrition.ts`,
  `server/storage/favourite-recipes.ts`, `server/storage/__tests__/users.test.ts`.

## Scope Contract

- **Mechanisms to use:** move functions and types; re-export through
  `server/storage/index.ts`.
- **Files in scope:** the files listed above.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #1744 (subscription split) — satisfied, merged 2026-11-04.

## Updates

### 2026-11-04

- Filed from the `/todo` run's deferred warnings (PR #1744). Human-led
  because the remaining sections are auth storage.
