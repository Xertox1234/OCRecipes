---
title: "Auth-adjacent: silent identity lookup in password notice; unchecked User shapes in useAuth"
status: done
priority: low
created: 2026-11-05
updated: 2026-11-05
assignee: claude
labels: [audit, code-quality, auth]
github_issue:
---

# Auth-adjacent: silent identity lookup in password notice; unchecked User shapes in useAuth

## Summary

Group B of the 2026-11-05 code-quality audit (CQ7, CQ9, CQ10). Auth is high-risk: implemented by the orchestrator, never delegated; reviewed by security-auditor.

## Acceptance Criteria

- [x] CQ7 `listIdentities(...).catch(() => [])` in `server/routes/auth-password.ts` and `server/routes/auth.ts` logs a warning on failure (notice still sends)
- [x] CQ9 `client/hooks/useAuth.ts` cached-profile read rejects a parseable but wrong-shaped blob the same way as a corrupt one
- [x] CQ10 change-email response is narrowed with the same guard; no `as unknown as User`
- [x] The guard lives in a small helper outside `useAuth.ts` (that file has a shrink todo — don't grow it)
- [x] Do not touch `serializeUser` (knip row; owner directive: unused ≠ removable)

## Scope Contract

- **Files in scope:** `server/routes/auth-password.ts`, `server/routes/auth.ts`, `client/hooks/useAuth.ts`, one new `client/lib/*` guard helper, their tests
