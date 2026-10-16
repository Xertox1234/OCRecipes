---
title: "A route that answers with the value IT computed, not what storage returned, hides an UPDATE that matched no row — and a storage-mocked route test locks the lie in"
track: bug
category: logic-errors
tags: [database, drizzle, upsert, api, testing]
module: server
applies_to: ["server/routes/**/*.ts", "server/storage/**/*.ts", "server/routes/__tests__/**/*.ts"]
symptoms: ["A toggle flips, then flips back after the screen refetches", "PATCH answers 200 with the request body echoed, but the database row is unchanged", "A setting only fails to save for accounts missing a side row (no profile, seeded/test users)"]
created: 2026-10-16
severity: low
---

# A route that answers with the value IT computed, not what storage returned, hides an UPDATE that matched no row

## Problem

`PATCH /api/reminders/mutes` read the profile, merged the request in, called
`storage.updateUserProfile(userId, { reminderMutes: merged })` and answered
`res.json({ reminderMutes: merged })`. `updateUserProfile` is a plain
`UPDATE … WHERE user_id = $1 RETURNING *`. For an account with **no
`user_profiles` row** that matches zero rows and returns `undefined`, which the
route ignored. The client got `200` with exactly what it sent, flipped the
switch, then refetched `null` and flipped it back.

The route test `"returns 200 with incoming mutes when no profile exists yet"`
mocked both storage calls to `undefined` and asserted the echo, so it certified
the no-op as correct behaviour.

## Root cause

Two things combined:

1. **The response came from the route's own variable, not the write's result.**
   Nothing tied "the client was told X" to "the database holds X".
2. **An UPDATE assumes a row exists.** `user_profiles` rows are created at
   onboarding, so a missing row was never a tested state. But seeded accounts and
   any half-onboarded account don't have one.

## Fix

- One storage call that cannot match nothing: an upsert that creates the bare row
  (every other column has a default) or merges into the existing one, returning
  the stored value:

  ```ts
  const [row] = await db
    .insert(userProfiles)
    .values({ userId, reminderMutes: mutes })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        reminderMutes: sql`${userProfiles.reminderMutes} || excluded.reminder_mutes`,
        updatedAt: new Date(),
      },
    })
    .returning({ reminderMutes: userProfiles.reminderMutes });
  return row.reminderMutes;
  ```

- The route answers with **what storage returned**: `res.json({ reminderMutes })`.
- The merge test lives at the **real-DB storage layer**
  (`server/storage/__tests__/users.test.ts`), asserting a key that was NOT in the
  request survives. A storage-mocked route test can't distinguish merge from
  overwrite.

(PR #1456.) If the write should NOT create the row, check the `undefined` and
answer `404`, as `PUT /api/user/dietary-profile` does.

## Prevention

- For any write route, the response body comes from the storage call's **return
  value**, never from a local the route computed. If the storage function returns
  `T | undefined`, the route must branch on `undefined`.
- A route test that mocks storage to `undefined` and still expects `200` with the
  request echoed is asserting the bug. Ask what the database holds afterwards.
- `ON CONFLICT (col)` needs a real unique index in the deployed DB, not just
  `.unique()` in `shared/schema.ts`. Tables that predate `migrations/` came
  from `db:push`, so check prod's `pg_indexes` before relying on it.
- Related: [upsert-with-onconflictdoupdate](../design-patterns/upsert-with-onconflictdoupdate-2026-05-13.md).
