---
title: "Token-version cache can re-cache a pre-revoke version for up to 60 s"
status: done
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security]
github_issue:
---

# Token-version cache can re-cache a pre-revoke version for up to 60 s

## Summary

`requireAuth` reads the user on a cache miss and caches the version AFTER the await; an invalidate (reset/logout/delete/2FA change) landing between the two re-caches the old version for the 60 s TTL.

## Background

Auth audit 2026-10-10 L3. Accepted cross-instance staleness (60 s) is documented, but this is the revoking process re-caching a stale value after its own invalidate — a stolen token can survive a reset for up to 60 s, and a deleted user's token passes requireAuth for up to 60 s.

Source: auth security audit 2026-10-10 (manifest `docs/audits/2026-10-10-security.md`, local-only); deferred at owner triage 2026-10-11.

## Acceptance Criteria

- [x] Keep a per-user invalidation epoch (or min version) set by invalidateTokenVersionCache; a cache fill only stores a version ≥ the floor / when no invalidate happened since the read began
- [x] Real-module test (server/**tests**/auth.test.ts style, no middleware mock) reproduces the interleave and proves the fix

## Implementation Notes

- `server/middleware/auth.ts:157-171`
- Related: `docs/solutions/*token-versioning-jwt-revocation-2026-05-13.md`
- AUTH = never delegate.

## Scope Contract

- **Mechanisms to use:** existing patterns in the files below — nothing new beyond what an acceptance criterion needs
- **Files in scope:** `server/middleware/auth.ts`, `server/__tests__/auth.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Auth code: never delegate to cheap workers; review with security-auditor.

## Updates

### 2026-10-11

- Initial creation (deferred from the auth security audit)

- Fixed: a process-wide invalidation counter; a cache fill is kept only when no invalidate landed during its read (real-module test reproduces the interleave). Global, not per-user — no eviction needed, a skipped fill costs one read.
