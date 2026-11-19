---
title: "Check the shape of a 200 /api/auth/me answer before caching it as the profile"
status: backlog
priority: low
created: 2026-11-19
updated: 2026-11-19
assignee:
labels: [deferred, reliability, auth]
github_issue:
human_led: true
blocked_reason: "auth — human-led per the never-delegate rule"
---

# Check the shape of a 200 /api/auth/me answer before caching it as the profile

## Summary

`runAuthCheck` writes `await response.json()` from a 200 `/api/auth/me` straight to AsyncStorage and to auth state with no `isUser()` check, while the cached-profile path does check. A captive portal or proxy that answers 200 with wrong-shape JSON would be stored as the user.

## Background

Reliability audit 2026-11-19, finding L-crel-3 (`docs/audits/2026-11-18-reliability.md`). Class 5/6. Latent: the API-reachability probe and normal server behaviour make it unlikely. Owner triage: auth stays human-led.

## Acceptance Criteria

- [ ] A 200 whose body fails `isUser()` is treated like a network failure (resume from the cached profile, token kept, nothing wiped), not cached.
- [ ] Test: a 200 with a non-user body leaves the cached profile and token untouched.

## Implementation Notes

- `client/hooks/auth-session.ts:367-379` (the `response.ok` branch); `isUser` is already used at `:285`.

## Scope Contract

- **Files in scope:** `client/hooks/auth-session.ts` and its test.
- No new mechanisms.

## Dependencies

- None

## Risks

- Auth path: verify by hand; never delegated.

## Updates

### 2026-11-19

- Filed from the reliability audit (L-crel-3).
