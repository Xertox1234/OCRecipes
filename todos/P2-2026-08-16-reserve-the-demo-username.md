---
title: "Nothing reserves the username `demo`, and two cleanup scripts resolve their deletion scope by that exact string"
status: backlog
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
