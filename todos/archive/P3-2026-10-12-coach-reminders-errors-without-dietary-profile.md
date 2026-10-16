---
title: "Coach Reminders shows a load error for a user with no dietary profile"
status: done
priority: low
created: 2026-10-12
updated: 2026-10-16
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

- [x] With a `null` dietary profile the screen shows the reminder switches (all on) instead of an error.
- [x] A test covers the `null` response.
- [x] Muting a category for a user with no profile either works or explains why — check what `PATCH /api/reminders/mutes` does without a profile row.

## Implementation Notes

- `client/screens/CoachRemindersScreen.tsx` `useReminderMutes` `select`: accept `profile: { reminderMutes?: ReminderMutes } | null` and use `profile?.reminderMutes ?? {}`.
- Check `PATCH /api/reminders/mutes` in `server/routes/` for the no-profile case.
- The query key `QUERY_KEYS.dietaryProfile` is shared with `RecipeChatScreen` and `useDietaryProfileForm` — keep the `select` local.

## Scope Contract

- **Files in scope:** `client/screens/CoachRemindersScreen.tsx`, its `__tests__`, and the reminders-mutes route only if it also fails without a profile.
- **Widened 2026-10-16 (owner ruling "make it work"):** `server/routes/reminders.ts` + its test, `server/storage/users.ts` (`saveReminderMutes`), `server/storage/index.ts`, `server/storage/__tests__/users.test.ts`.

## Dependencies

- None.

## Risks

- Low.

## Updates

### 2026-10-12

- Filed while verifying PR #1401 (screen chrome).

### 2026-10-16

- The mute route did fail without a profile: `updateUserProfile` is a plain UPDATE, so it matched no row and the route still answered `200` with the request echoed back (a route test locked that in). Owner chose "make it work".
- New `saveReminderMutes` does one `INSERT … ON CONFLICT (user_id) DO UPDATE` that merges with jsonb `||`, creating a bare profile row when missing. The route returns what was stored.
- Screen `select` accepts `null`. New `CoachRemindersScreen.test.tsx` covers the `null` profile and a muted category.
