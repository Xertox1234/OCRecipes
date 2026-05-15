---
title: "Account deletion flow (CCPA/PIPEDA right to erasure)"
status: backlog
priority: high
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [compliance, privacy, deferred]
github_issue:
---

# Account Deletion Flow

## Summary

Implement a user-initiated account deletion flow: a server-side `DELETE /api/users/me` route that hard-deletes the user row (triggering cascade deletes on all owned data), plus a confirmation UI in the Profile screen.

## Background

CCPA and PIPEDA both grant users the right to erasure. The database schema already uses `onDelete: "cascade"` on all `userId` foreign keys, so a single `DELETE FROM users WHERE id = $userId` will propagate across all 40+ user-owned tables. What is missing is the server route to trigger it and the in-app UI to initiate it. This is also a common Apple App Store review requirement for apps that collect personal or health data.

## Acceptance Criteria

- [ ] `DELETE /api/users/me` route exists, behind `requireAuth`, with rate limiting
- [ ] Route requires password confirmation in the request body (Zod-validated) to prevent accidental deletion
- [ ] Route hard-deletes the user row; cascade handles all owned data
- [ ] Route invalidates the JWT (`invalidateTokenVersionCache`) before returning 204
- [ ] Client-side: "Delete Account" button in Profile settings, behind a confirmation alert ("This will permanently delete all your data")
- [ ] After deletion, `AuthContext.logout()` is called and the user is navigated to the login screen
- [ ] Server route test: unauthenticated request → 401; wrong password → 403; correct password → 204 + user gone
- [ ] No soft-delete — this must be a hard delete to satisfy erasure rights

## Implementation Notes

- Route file: `server/routes/users.ts` (or create `server/routes/account.ts` if it doesn't exist)
- Storage function: `deleteUser(userId: string): Promise<void>` in `server/storage/users.ts`
- Must call `invalidateTokenVersionCache(req.userId)` before responding to prevent reuse of an in-flight token
- Password confirmation: fetch user via `getUserForAuth`, `bcrypt.compare`, then delete
- UI location: Profile tab → Settings section → "Delete Account" (destructive red text, bottom of list)
- Do NOT delegate — touches JWT auth and user health data boundaries

## Dependencies

- Existing cascade constraints in `shared/schema.ts` (already in place)
- `server/middleware/auth.ts` — `invalidateTokenVersionCache`

## Risks

- IAP subscription: if the user has an active Apple/Google subscription, deletion does not cancel it at the platform level. Consider surfacing a warning: "Cancel your subscription before deleting your account."
- Cascades are only as good as the FK constraints — verify every table has the FK before shipping

## Updates

### 2026-05-10

- Created from compliance review (North America launch planning)
