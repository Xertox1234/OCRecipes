---
title: "A push token belongs to the app install and OS-scheduled notifications outlive the session — sign-out must clear both, or the last user's reminders reach the next"
track: bug
category: logic-errors
tags: [client-state, security, react-native]
module: client
applies_to: ["client/hooks/useAuth.ts", "client/lib/push-token-registration.ts", "client/hooks/useNotebookNotifications.ts", "server/storage/push-tokens.ts"]
symptoms: ["After A signs out (or B signs in on A's phone) A's coach reminders still appear on the lock screen", "Push rows for two users carry the same Expo push token", "A free user who never opens Coach Pro keeps receiving the previous user's scheduled reminders"]
created: 2026-10-11
severity: high
---

# A push token belongs to the app install and OS-scheduled notifications outlive the session — sign-out must clear both, or the last user's reminders reach the next

## Problem

Auth audit 2026-10-10 H2 + M2. Coach reminders carry the user's journal text (health data). Two device-level stores outlived every sign-out path:

1. **Server push registration.** `push_tokens` was unique on `(user_id, platform)`, not `token`, and nothing ever deleted a row on sign-out (`DELETE /api/push-tokens` existed but the client never called it). After A signs out and B signs in, A's row still points at the phone.
2. **OS-scheduled local notifications.** `scheduleNotificationAsync` reminders and the global `COACH_NOTIFICATION_IDS` AsyncStorage key were swept by no teardown path; only Coach Pro's screen cleaned stale ones.

## Symptoms

- The previous account's reminders (with journal snippets) show on a signed-out phone, or under the next account.

## Root Cause

The teardown sweep (`clearDurableLocalState`) covered app-owned stores (query cache, offline queue, recents). State the app *registered elsewhere* — with the push server, and with the OS scheduler — was not in the inventory. Expo's push FAQ: an `ExpoPushToken` belongs to the install (stable across upgrades and, on iOS, reinstalls), never to a user.

## Solution

- **Server:** `upsertPushToken` deletes the same token from every OTHER user in the same transaction before its `(user, platform)` upsert — a device belongs to one account at a time. (No migration needed.)
- **Client sign-out:** `logout()` awaits `unregisterPushToken()` BEFORE the logout POST (which revokes the bearer the DELETE needs). It never prompts for permission, never throws, and is capped at 3 s — with a `timedOut` flag checked right before the DELETE, because `apiRequest` reads the bearer at send time and a late DELETE would carry the NEXT user's token and remove their row (caught in review, proven by probe).
- **Teardown sweep:** `clearScheduledCoachReminders()` (cancel all scheduled + dismiss delivered + remove the id map) runs in `clearDurableLocalState`, feeding its `ok` flag so a failed wipe keeps the durable-owner marker stale and retries.

`expireSession` cannot unregister (its token is dead) — the server-side reassignment on the next sign-in is the backstop.

## Prevention

When auditing a teardown sweep, inventory state the app registered OUTSIDE itself: push registrations, OS schedulers, keychain items, background tasks — not only AsyncStorage keys.

## Related Files

- `server/storage/push-tokens.ts`, `client/lib/push-token-registration.ts`, `client/hooks/useAuth.ts`, `client/hooks/useNotebookNotifications.ts`

## See Also

- [durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay](durable-write-queue-not-cleared-on-auth-teardown-cross-account-replay-2026-06-19.md) — the same class for the offline write queue
- [request-dispatched-in-one-session-lands-in-the-next](request-dispatched-in-one-session-lands-in-the-next-2026-10-11.md) — the late-DELETE hazard in general
