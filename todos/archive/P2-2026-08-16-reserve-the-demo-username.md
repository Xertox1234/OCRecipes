---
title: "Nothing reserves the username `demo`, and two cleanup scripts resolve their deletion scope by that exact string"
status: done
priority: medium
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [data-loss, scripts, auth]
github_issue:
---

# The deletion perimeter is keyed on a username anyone can register

## Summary

Both cleanup scripts resolve "the demo account" with `eq(users.username, "demo")`, and nothing
in the codebase prevents a real person from registering that username. In an environment with
no pre-existing demo account, a real user can take it and thereby move their own recipes inside
the scripts' deletion perimeter.

## Background

Verified on `main` 2026-08-16:

- `server/scripts/cleanup-seed-recipes.ts:96` — `.where(eq(users.username, "demo"))`
- `scripts/cleanup-junk-recipes-utils.ts:31-36` — resolves it the same way, and **already
  documents this exact residual in prose**
- `server/storage/users.ts:90` `createUser` inserts whatever username it is given; a repo-wide
  search for `reservedUsernames` / `RESERVED_USERNAMES` / any reserved-or-blocklist check on
  registration returns **nothing**

**Scope it accurately — the blast radius is narrower than "a real user gets deleted".**
`buildJunkRecipeWhere` is `(orphan OR demo-authored) AND (seed-prefix OR test-prefix OR legacy
test names)`. So a real `demo` user only loses recipes whose normalized product name also
starts with `seed-`/`test-` or matches a legacy test name. That is unlikely but not impossible
(a user experimenting with a recipe literally titled "test"), and both scripts are dry-run by
default, so an operator has a chance to notice.

That combination is why this is medium and not high: real but narrow, and gated behind an
operator typing `--commit`. It is worth fixing because the mitigation is trivial and the
current one is a comment.

**The fix does NOT belong in the two scripts.** Their behaviour is correct given their
premise; the premise ("`demo` is ours") is what is unenforced. Fixing it at the write path
fixes both consumers at once — an instance of
`docs/solutions/conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md`.

## Acceptance Criteria

- [ ] Registration rejects a reserved username, `demo` included, with a clear user-facing
      message (not a 500)
- [ ] The check lives at ONE choke point that both the route and any script-driven creation
      pass through — `server/storage/users.ts` `createUser` is the natural site; a check only in
      `server/routes/auth.ts` leaves the seeding path free to create it
- [ ] Case- and whitespace-insensitive: `Demo`, `DEMO`, `demo` must all be rejected, since
      the lookup they endanger is an exact-string match
- [ ] `npm run seed:recipes` can still create its demo account (the reservation must not break
      the tool that legitimately owns the name — decide explicitly how: an internal bypass, or
      seeding before the check applies)
- [ ] Verified RED first: a test asserting registration-as-`demo` is refused, confirmed failing
      before the change
- [ ] The now-enforced invariant is noted where it was previously only described —
      `scripts/cleanup-junk-recipes-utils.ts:31-36` — so the prose stops describing a live risk
- [ ] Closes with zero follow-ups

## Implementation Notes

- **This touches authentication.** Per CLAUDE.md that means: never delegate it to a kimi
  worker, and the route tests mock the auth middleware, so a route-level test can pass while
  the real path is unprotected (`project_auth_recurring_breakage`). Prefer the storage-layer
  choke point and test it directly.
- Check whether a user already holds `demo` in any real environment before shipping a hard
  rejection; if one does, this needs a decision rather than a migration.
- Keep the reserved list tiny and obvious (`demo`, and whatever the seeds actually use). A long
  vanity blocklist is scope creep.

## Scope Contract

- **Mechanisms to use:** a constant list plus a check at the existing user-creation function —
  no new middleware, no new table, no schema change
- **Files in scope:** `server/storage/users.ts`, its `__tests__`, `server/routes/auth.ts` if the
  error surface needs it, and a comment update in `scripts/cleanup-junk-recipes-utils.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- **Breaking the seed path** is the likeliest way this goes wrong — `npm run seed:recipes`
  creates the demo account on purpose, and a naive check makes seeding impossible. Decide that
  interaction before writing the check, not after.
- A hard rejection on an existing production `demo` holder would lock a real user out of
  account changes; check first.

## Updates

### 2026-08-16

- Filed at the user's request after being surfaced (and deliberately not auto-filed) during the
  #833–#848 review round. Both call sites, the absent reservation mechanism, and the actual
  `AND (seed|test|legacy)` narrowing were verified against `main` — the earlier framing of this
  item ("the fix must land in both scripts") was wrong and is corrected here: the fix belongs at
  the user-creation choke point.

### 2026-08-17 — DONE

- `RESERVED_USERNAMES = ["demo"]` + `ReservedUsernameError` added to
  `server/storage/users.ts`; `createUser` rejects a reserved name trimmed +
  lowercased, so `Demo` / `DEMO` / `demo` are all refused. Whole-string, not a
  prefix — `demo_user`, `demonstration`, `mydemo`, `demo1` stay registerable
  (pinned by an explicit negative-control test).
- **AC4 resolved with no bypass flag needed.** `npm run seed:recipes` still
  creates its demo account because `server/scripts/seed-recipes.ts:261` inserts
  into `users` DIRECTLY rather than calling `createUser`. That coupling is now
  documented at the `createUser` docblock: if the seed is ever refactored to go
  through `createUser`, the fix is an explicit bypass at that call site, NOT
  removing the reservation.
- Route surface: `server/routes/auth.ts` maps `ReservedUsernameError` to a 409
  with "That username is reserved. Please choose another." — verified it is not
  a 500.
- Verified RED first (9 failing / 4 negative controls passing), then GREEN.
- **Defect found and fixed during this work:** adding
  `err instanceof ReservedUsernameError` to the register catch block broke two
  PRE-EXISTING unique-violation tests. `auth.test.ts` mocks `../../storage`, so
  the imported class was `undefined`, and `instanceof undefined` THROWS —
  converting every error in that catch block into a 500. The mock factory now
  provides the class (same pattern as `batch-scan.test.ts`'s
  `BatchStorageErrorMock`), and a new route test pins the 409 so the mock cannot
  silently regress.
- Residual, stated not migrated: an account that already held `demo` before this
  landed is unaffected — the check runs at creation, not retroactively. Recorded
  in the `scripts/cleanup-junk-recipes-utils.ts` docblock.

### 2026-08-17 — security review round: one CRITICAL, found and fixed

- **The first implementation introduced an email-existence oracle.** Rejecting
  only via `createUser`'s throw put the 409 AFTER the register handler's neutral
  email-existence branch. Holding a reserved username fixed and varying only the
  email then gave two different responses: taken -> neutral `200`
  `verification_pending`, free -> `409` reserved. One request, no side effects,
  infinitely repeatable — against an endpoint deliberately engineered against
  exactly this (content-free neutral response, bcrypt pre-paid to flatten
  timing, `pendingEmail` left unconstrained).
- `DEMO` (uppercase) is what makes it work in every environment: there is no
  `lower(username)` unique index (only `migrations/0009_users_email_lower_unique.sql`
  covers email), so `DEMO` MISSES the username uniqueness pre-check while the
  case-folded reservation still rejects it.
- **Fix:** the rejection moved to `server/routes/auth.ts`'s username pre-check —
  the one signup slot that is deliberately NOT the neutral check-inbox response,
  so both answers there are username-shaped and varying the email changes
  nothing. `isReservedUsername` is now exported and shared by route and storage
  so the two normalizers cannot drift. `createUser`'s throw and the catch arm
  stay as defense-in-depth for non-route callers.
- Pinned by a differential test (`does NOT leak email existence via a reserved
username`) with a non-reserved negative control. **Mutation-verified**:
  disabling the route check makes `expect(taken.status).toBe(free.status)` fail,
  so the pin is real and not a decoration.
- Also fixed: `scripts/cleanup-junk-recipes.ts` (the file that issues the
  `DELETE`) still asserted in two comments that `demo` is NOT reserved, directly
  contradicting the sibling docblock updated in the same commit. Contradictory
  safety documentation on a permanent-delete perimeter is how the next reader
  mis-scopes a live run.
- Review also confirmed clean: no reachable normalization bypass (`registerSchema`'s
  `/^[a-zA-Z0-9_]+$/` rejects every Unicode/zero-width/NUL variant that would slip
  past the trim+lowercase); no other `insert(users)` path besides the intended
  seed script; no lockout risk for an existing holder (`UpdatableUserFields`
  excludes `username`, and login is untouched).
