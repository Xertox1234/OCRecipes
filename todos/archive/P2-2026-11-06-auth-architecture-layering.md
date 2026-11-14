---
title: "Auth layering: move session/MFA/account-deletion logic out of routes and lib into services; split users + identities storage"
status: done
priority: medium
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, architecture, security]
github_issue:
human_led: true
---

# Auth layering: services for session issuance, MFA and account deletion

## Summary

Four findings from the 2026-11-06 architecture audit (M1, M2, L1 and the auth-adjacent half of M4) put auth logic in the wrong layer. Each is a refactor of sign-in, MFA or account code, so it is human-led: never dispatched to an executor or a kimi script.

## Background

- **M1:** `server/routes/auth-social.ts` (940 lines) doubles as an auth service. `HttpFailure`, `issueSession`, `reauthenticate` and `revokeAppleIdentities` (lines ~70-251) are imported by three other route files: `auth.ts:78`, `auth-password.ts:16` and `auth-mfa.ts:36`. Session issuance lives in a route module, so a change there must be re-verified against the MFA, password and account-deletion flows.
- **M2:** `server/lib/mfa/challenge.ts:1`, `email-code.ts:1-2` and `verify-second-factor.ts:1-2` import `storage` and `services/email` at runtime. These are the only runtime lib→storage/services edges in the tree, and they break the "lib is a leaf" rule (`.claude/agents/server-reviewer.md:116`).
- **L1:** the account-deletion handler in `server/routes/auth.ts` (~1005-1045) inlines the Apple token take, the image collect, `deleteUser`, cache invalidation and blob cleanup. Its order is testable only through the route.
- **M4 (auth half):** `server/storage/users.ts` (535 lines) and `server/storage/identities.ts` (521 lines) are over the 500-line storage split rule (`docs/rules/architecture.md`). They were deferred from the audit PR because both are auth-adjacent. The audit split `nutrition.ts` and `community-recipes.ts`.

Deferred, not fixed in the audit PR, because the project rule says auth work is never delegated (MEMORY: auth is high-risk) and the owner chose a separate auth PR.

## Acceptance Criteria

- [x] `issueSession`, `reauthenticate`, `revokeAppleIdentities` and `HttpFailure` live in `server/services/` (e.g. `auth-session.ts`); no route file imports another route file for them
- [x] `server/lib/mfa/{challenge,email-code,verify-second-factor}.ts` move to `server/services/mfa/`; `server/lib/` has no runtime import of `storage` or `services`
- [x] Account deletion's ordered cleanup is one service function with its own unit test pinning the order
- [x] `users.ts` and `identities.ts` are each under 500 lines, split as pure moves behind re-exports (precedent #1782); moved code byte-identical to main
- [x] Existing auth route and storage tests pass unchanged; real-DB auth integration green in CI

## Implementation Notes

- Pure moves first, one commit per finding, so each review sees a byte-identical move.
- Check `vi.mock("../auth-social")`-style mocks in the route tests before moving symbols. They must follow the new path.
- Files: `server/routes/auth-social.ts`, `auth.ts`, `auth-password.ts`, `auth-mfa.ts`, `server/lib/mfa/*`, `server/storage/users.ts`, `server/storage/identities.ts`, and their `__tests__`.

## Resolution (2026-11-06)

- M4: `users.ts` 535 → 356 (`user-email.ts`, `user-columns.ts`); `identities.ts` 521 → 456 (`apple-tokens.ts`). Pure moves, re-exported.
- M2: `challenge`, `email-code`, `verify-second-factor` and `password-proof-gate` (it calls verify-second-factor) moved to `server/services/mfa/`; `mfa-secrets` stays in lib. `server/lib/` has no runtime import of storage or services.
- M1: `server/services/auth-session.ts` owns `HttpFailure`, `issueSession`, `reauthenticate`, `revokeAppleIdentities` and their helpers; `serializeUser` moved to `server/lib/serialize-user.ts`. Kept edges: services → `middleware/auth` (`generateToken`, `invalidateTokenVersionCache`) and a type-only `ReauthProof` import from `routes/_schemas`.
- L1: `server/services/account-deletion.ts` `deleteAccount()` with an order-pinning unit test.
- Last box: the auth route and storage tests pass locally; real-DB CI is pending on the PR.
