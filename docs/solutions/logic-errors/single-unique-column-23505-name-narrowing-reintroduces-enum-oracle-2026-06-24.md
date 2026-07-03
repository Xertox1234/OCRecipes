---
title: 'On a neutral anti-enum endpoint, name-narrowing a single-unique-column 23505 re-leaks existence'
track: bug
category: logic-errors
module: server
severity: medium
tags: [anti-enumeration, postgres, unique-violation, error-handling, auth]
symptoms: [A neutral anti-enumeration endpoint returns 200 for a free target but 500 for an already-taken one (or vice-versa) — a status-code existence oracle., A duplicate-handling catch checks uniqueViolationConstraint(err)?.includes("...") and falls through to `throw err` when the constraint name is absent/unrecognized.]
applies_to: [server/routes/**/*.ts]
created: '2026-06-24'
---

# On a neutral anti-enum endpoint, name-narrowing a single-unique-column 23505 re-leaks existence

## Problem

`POST /api/auth/change-email` returns a deliberately neutral
`verification_pending` whether the target email is free or already taken, so a
caller cannot enumerate which addresses have accounts. The duplicate case is
detected by catching the Postgres `23505` that `updateUserEmail` raises. The
first implementation narrowed that catch by constraint name, mirroring the
`register` handler:

```ts
if (isUniqueViolation(err) && uniqueViolationConstraint(err)?.includes("email")) {
  return verificationOn ? sendVerificationPending(res) : sendError(res, 409, ...);
}
throw err; // ← anything whose constraint name isn't surfaced ends up here → 500
```

This silently re-introduces the exact enumeration oracle the endpoint exists to
prevent: if the driver ever fails to surface the constraint name (a functional
index like `users_email_lower_unique`, a drizzle wrapper change, a future PG
version), the collision falls through to `throw err` → **500 for a taken
address vs 200 for a free one**. The response body stays neutral but the status
code leaks existence.

## Symptoms

- A neutral anti-enum endpoint returns 200 for a free target but 500 for a
  taken one (or the reverse) — a status-code existence oracle.
- A `23505` catch is gated on `uniqueViolationConstraint(err)?.includes("…")`
  and re-throws on a missing/unrecognized constraint name.

## Root Cause

Constraint-name narrowing is only needed to **disambiguate which of several
unique columns** a single statement could have violated. `register` needs it:
`createUser` inserts a row that can collide on `username` OR `email`, and each
maps to a different response. But a statement that can violate only **one**
unique column has nothing to disambiguate — the name check adds only a failure
mode (re-throw on a name the driver didn't surface), and on a neutral endpoint
that failure mode is itself the information leak.

`updateUserEmail` sets only `email` + `email_verified`; `email_verified` is not
unique, so the only `23505` it can raise is an email collision. The name gate
was pure downside.

## Solution

Branch on `isUniqueViolation(err)` **alone** when the statement can violate only
one unique column:

```ts
if (isUniqueViolation(err)) {
  return verificationOn
    ? sendVerificationPending(res) // neutral — no existence leak
    : sendError(res, 409, "Email already registered", ErrorCode.CONFLICT);
}
throw err;
```

This removes the fragile dependency on the constraint name surfacing correctly,
and the neutral path no longer depends on driver internals.

## Prevention

- **Decide by column count, not by copying a sibling handler.** Narrow a
  `23505` catch by constraint name only when the statement can violate **more
  than one** unique column. Single-unique-column statement → branch on the code
  alone.
- On any endpoint that returns a deliberately neutral (anti-enum) response,
  audit every `catch` for a path that can fall through to a different status
  code (a `throw`/500) on a subset of inputs — that fall-through is the oracle.
- Lock it with a test that drives the duplicate path with a `23505` carrying
  **no** `constraint` field and asserts the neutral status still holds.

## Related Files

- `server/routes/auth.ts` — `POST /api/auth/change-email` duplicate catch
- `server/storage/users.ts` — `updateUserEmail` (single-unique-column UPDATE)
- `server/lib/db-errors.ts` — `isUniqueViolation` / `uniqueViolationConstraint`
- `server/routes/__tests__/auth.test.ts` — the constraint-name-free `23505` test

## See Also

- [multi-unique-column-23505-needs-constraint-name](multi-unique-column-23505-needs-constraint-name-2026-06-18.md) — the inverse case: when a statement CAN violate several unique columns, you MUST branch on the name
- [anti-enum-equalize-awaited-work-before-existence-check](anti-enum-equalize-awaited-work-before-existence-check-2026-06-19.md) — the companion anti-enum rule on equalizing awaited work
- [../conventions/detect-pg-error-code-via-cause-not-message-2026-05-23.md](../conventions/detect-pg-error-code-via-cause-not-message-2026-05-23.md) — why `isUniqueViolation` checks `err.cause.code`, not message text
