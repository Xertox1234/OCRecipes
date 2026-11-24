---
title: "Goals save and consent withdrawal lock users and user_profiles in opposite orders"
status: done
priority: low
created: 2026-11-24
updated: 2026-11-24
assignee:
labels: [deferred, database]
github_issue:
---

# Goals save and consent withdrawal lock users and user_profiles in opposite orders

## Summary

`updateUserGoalsAndProfile` updates the `users` row and then the
`user_profiles` row. `withdrawHealthConsent` updates `user_profiles` and then
`users`. Two such requests for one user at the same moment can deadlock;
Postgres then aborts one of them with an error.

## Background

Found by the server review of PR #2007, which fixed the same kind of clash
between an allergy card save and the withdrawal. It was left out because it
involves no Coach card and needs its own check of every path that writes both
tables. Nothing is lost when it happens: one request fails with a 500 and a
retry works. It needs the same user to save goals and withdraw consent within
the same instant, so it is rare. Found by reading; not reproduced.

## Acceptance Criteria

- [x] A real-database test (multi-connection, like `server/storage/__tests__/coach-write-cards.concurrent.test.ts`) reproduces the clash first; if it does not reproduce, close with a note.
- [x] Every transaction that writes both `users` and `user_profiles` takes the two locks in the same order.
- [x] The order chosen still agrees with the Coach card saves: an allergy card locks its card and then the profile; a goals card locks its card and then `users`; the withdrawal closes allergy cards first.
- [x] The test passes after the change.

## Implementation Notes

- `server/storage/users.ts` `updateUserGoalsAndProfile` (caller: `server/routes/goals.ts`): `users`, then `user_profiles`.
- `server/storage/user-profiles.ts` `withdrawHealthConsent`: allergy cards, then `user_profiles`, then `users`.
- Simplest change to try: in the withdrawal, move the `users` update ahead of the `user_profiles` update (after the card expiry). Check first for any other path that locks profile then users.

## Scope Contract

- **Mechanisms to use:** reorder existing statements; no new locks or abstractions.
- **Files in scope:** `server/storage/user-profiles.ts`, `server/storage/users.ts`, and their tests under `server/storage/__tests__/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Reordering one path can create a clash with a third path; list every writer of both tables before changing the order.

## Updates

### 2026-11-24

- Initial creation

### 2026-11-24 (done)

- Done in PR #PRNUM.
- Reproduced on the real database in `server/storage/__tests__/user-profiles.concurrent.test.ts`: a goals save clashed with the withdrawal and also with the onboarding save (`upsertProfileWithOnboarding`), which this todo did not list.
- The order is now `users`, then `user_profiles`, in all three. The goals save already had it. The onboarding save's `users` update moved to the top. The withdrawal takes a row lock on `users` after closing the allergy cards and before the profile update; its own `users` update stays after the profile check, so a user with no profile row is left untouched as before. That is one added lock statement, where the scope contract asked for reordering only: moving the update itself would have cleared goals for a user with no profile.
