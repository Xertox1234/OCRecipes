---
title: "Coach Reminders shows a load error for a user with no dietary profile"
status: backlog
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, ui]
github_issue:
---

# Coach Reminders shows a load error for a user with no dietary profile

## Summary

Settings → Coach Reminders shows "Couldn't load your reminder settings" for an account with no dietary profile, even though the request succeeds.

## Background

Found 2026-10-12 while checking PR #1401 in the simulator as the seeded `demo` account (no `user_profiles` row). `GET /api/user/dietary-profile` returns `200` with `null` (`server/routes/profile.ts` — `res.json(profile || null)`). The query's `select` in `client/screens/CoachRemindersScreen.tsx` (`useReminderMutes`, ~`:56-73`) reads `profile.reminderMutes`, which throws on `null`, so React Query puts the query in its error state. Present on `main`; not caused by #1401.

Real users normally get a profile at onboarding, so this mostly hits seeded/test accounts — but any account without a profile row cannot mute reminders.

## Acceptance Criteria

- [ ] With a `null` dietary profile the screen shows the reminder switches (all on) instead of an error.
- [ ] A test covers the `null` response.
- [ ] Muting a category for a user with no profile either works or explains why — check what `PATCH /api/reminders/mutes` does without a profile row.

## Implementation Notes

- `client/screens/CoachRemindersScreen.tsx` `useReminderMutes` `select`: accept `profile: { reminderMutes?: ReminderMutes } | null` and use `profile?.reminderMutes ?? {}`.
- Check `PATCH /api/reminders/mutes` in `server/routes/` for the no-profile case.
- The query key `QUERY_KEYS.dietaryProfile` is shared with `RecipeChatScreen` and `useDietaryProfileForm` — keep the `select` local.

## Scope Contract

- **Files in scope:** `client/screens/CoachRemindersScreen.tsx`, its `__tests__`, and the reminders-mutes route only if it also fails without a profile.

## Dependencies

- None.

## Risks

- Low.

## Updates

### 2026-10-12

- Filed while verifying PR #1401 (screen chrome).
