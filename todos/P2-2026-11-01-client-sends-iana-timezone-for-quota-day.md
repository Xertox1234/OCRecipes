---
title: "App must send the phone's timezone so daily quotas reset at local midnight"
status: backlog
priority: medium
created: 2026-11-01
updated: 2026-11-01
assignee:
labels: [deferred, client, auth]
github_issue:
---

# App must send the phone's timezone so daily quotas reset at local midnight

## Summary

#1671 made daily quotas count from the user's local midnight using `users.timezone`, and `PUT /api/auth/profile` now accepts a `timezone` that is written once. Nothing in the app sends it yet, so every user still falls back to UTC.

## Background

The owner approved merging #1671 on 2026-11-01 on condition that this app-side follow-up is filed. Server side: `server/routes/auth.ts:928` calls `storage.setUserTimezoneIfUnset`. App side: `client/lib/timezone.ts` already returns the device's IANA name.

## Acceptance Criteria

- [ ] After sign-in (and on app start when the stored user has no timezone), the app sends `{ timezone }` once via the existing profile update in `client/hooks/useAuth.ts`
- [ ] It is not re-sent on every launch once the server has a value
- [ ] A failure to send is silent and retried at the next launch; it never blocks sign-in
- [ ] Test covers the send-once behaviour

## Implementation Notes

- `client/hooks/useAuth.ts:666` — the existing `PUT /api/auth/profile` mutation.
- `client/lib/timezone.ts` — device IANA timezone.
- Confirm whether the user payload already exposes `timezone`; if not, use a local "sent" marker in storage.
- Write-once is deliberate (it stops quota gaming by changing timezone). Changing it later is out of scope; see the timezone_updated_at note on #1671.

## Scope Contract

- **Mechanisms to use:** the existing profile mutation and `client/lib/timezone.ts` — nothing new on the server
- **Files in scope:** `client/hooks/useAuth.ts`, `client/lib/timezone.ts`, their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- #1671 (merged)

## Risks

- Auth code path is high-risk in this repo — keep the change outside the sign-in critical path.

## Updates

### 2026-11-01

- Filed by the /todo run (owner condition for merging #1671).
