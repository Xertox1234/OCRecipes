---
title: "Every session end wipes scheduled coach reminders, and nothing reschedules them on sign-in"
status: done
priority: low
created: 2026-10-20
updated: 2026-10-21
assignee:
labels: [deferred, mobile, notifications, auth]
github_issue:
---

# Every session end wipes scheduled coach reminders, and nothing reschedules them on sign-in

## Summary

`clearDurableLocalState` in `client/hooks/useAuth.ts` (~line 95) calls `clearScheduledCoachReminders()`, which cancels all OS-scheduled notifications. It runs on every teardown, including expiry, a dead token on cold start, and signing out then straight back in as the same person. That person's pending commitment reminders are then gone for good.

## Background

Found by the ultrareview of PR #1371 (2026-10-20, re-verified on main `1b58bba6`). Audit M2 added the clear so that reminders don't stay on a signed-out or handed-over phone. That goal is right. The gap is that nothing restores them.

`scheduleCommitmentReminder` (`client/hooks/useNotebookNotifications.ts`) is only called from `client/screens/NotebookEntryScreen.tsx` when an entry is saved.

## Acceptance Criteria

- [x] **Needs a decision first:** reschedule on sign-in from the server's notebook entries (which have a commitment and a future reminder time), or keep the reminder map per user and restore it on the same user's sign-in. Record the choice here before building.
- [ ] After sign-out then sign-in as the same user, their future commitment reminders are scheduled again.
- [ ] A different user signing in on the phone never gets the previous user's reminders.
- [ ] Tests cover both cases.

## Implementation Notes

- Files likely in scope: `client/hooks/useAuth.ts`, `client/hooks/useNotebookNotifications.ts`, possibly a notebook query hook.
- Only matters when the server push path isn't delivering. Check whether server-driven reminders already cover commitments before building client rescheduling.

## Updates

### 2026-10-20

- Initial creation (ultrareview of #1371, finding 5).

### 2026-10-21

- **Owner decision: close with no change.** The server already delivers these reminders. `server/services/notification-scheduler.ts` runs at 09:00 daily, pushes every due commitment to all of the user's registered devices, and records an in-app reminder through `notify()`. Signing back in re-registers the device's push token, so the same user still gets their reminders after a session ends. The wiped OS-scheduled reminder is only the client fallback for when push can't be delivered.
- The remaining acceptance criteria are not built, by that decision. Audit M2's clear stays as it is, so a different user on the phone never sees the previous user's reminders.
