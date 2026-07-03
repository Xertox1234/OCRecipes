---
title: Stage a unique value in an unconstrained column to verify it without a stage-time enumeration oracle
track: knowledge
category: design-patterns
module: server
tags: [anti-enumeration, email-verification, unique-constraint, staging-column, idempotency, auth]
applies_to: [server/routes/auth.ts, server/storage/users.ts]
created: '2026-06-24'
---

# Stage a unique value in an unconstrained column to verify it without a stage-time enumeration oracle

## When this applies

A user-initiated flow proposes a **new value for a UNIQUE column** that must be
**proven (verified) before it takes effect** — the canonical case is an
authenticated email change, where the new address must click a verification
link before it becomes the account's login address.

There are two tempting designs, **both of which leak existence** on a neutral
endpoint:

1. **Mutate the real column immediately (store as unverified).** Then
   `/api/auth/me` (or any read-back) reveals whether the target "took": free →
   the column changed; taken → it didn't (the unique index rejected it). It also
   creates a **typo-lockout**: a fat-fingered value immediately becomes the
   login-gating address the user does not control.
2. **Stage in a column that has its OWN unique constraint.** Now the stage
   itself fails-on-taken (23505), so a uniform neutral response is impossible —
   the caller learns the target exists at stage time.

## Rule

Stage the new value in a **nullable, UNCONSTRAINED** column. Enforce uniqueness
**only at commit time**, against the real column's existing index, via a
**two-branch idempotent verify**.

- **Stage:** write only the staging column. It can never 23505 (no constraint),
  so there is **no existence check** and the awaited work is uniform → the
  endpoint returns one neutral response for free / taken / same-as-current.
- **Commit (on verify):** one operation, two ordered, mutually-exclusive
  branches keyed on which column the proof token matches (case-insensitively):
  1. token matches the **current** value → mark verified in place (covers the
     non-change verify path, a re-sent link, and — idempotently — a second fetch
     of a change token _after_ it already committed, because the value now
     equals the token).
  2. token matches the **staged** value → commit the swap atomically (real =
     staged, verified, staged = NULL). The real column's unique index is the
     **TOCTOU-safe arbiter**: a value taken since staging raises a 23505 here,
     which the caller treats as a plain failed verify (not a 500).
- A token matching **neither** updates zero rows → the stale-link cross-check
  guard, now keyed on the staging column.

## Why

- **No oracle, both ends.** Immediate mutation leaks via read-back; a unique
  staging column leaks at stage time. An unconstrained staging column + neutral
  response + equalized awaited work leaks neither. (Anti-enum still requires
  equalizing _awaited_ work, not just the body — keep the existence-dependent
  send fire-and-forget; see
  [anti-enum-equalize-awaited-work-before-existence-check](../logic-errors/anti-enum-equalize-awaited-work-before-existence-check-2026-06-19.md).)
- **Typo-lockout closed structurally.** A mistyped value lands only in the
  staging column and never becomes the login-gating address unless its link is
  clicked — not a behavioral guard that can be bypassed.
- **Idempotent + self-healing.** Branch ordering makes a post-commit token
  re-match branch 1 harmlessly (mail-scanner prefetch then real click). The two
  UPDATEs need **no transaction**: they are mutually-exclusive predicates and
  each is atomic, so under READ COMMITTED concurrent commits cannot both win
  (the loser sees the staged column NULLed and updates 0 rows). The only
  residual anomaly is a benign false-negative that a retry heals — do **not**
  "fix" it with a transaction; there is no corruption to prevent.

## Examples

```ts
// STAGE — no constraint on pending_email, so this cannot 23505 (no oracle).
export async function stagePendingEmail(id: string, newEmail: string) {
  const [u] = await db
    .update(users)
    .set({ pendingEmail: newEmail }) // current email + verified UNTOUCHED
    .where(eq(users.id, id))
    .returning(safeUserColumns);
  return u || undefined;
}

// COMMIT — two ordered, mutually-exclusive branches.
export async function applyEmailVerification(id: string, tokenEmail: string) {
  // 1. token == current email -> verify in place (signup / re-verify / post-commit idempotent)
  const [verified] = await db
    .update(users)
    .set({ emailVerified: true })
    .where(and(eq(users.id, id), sql`lower(${users.email}) = lower(${tokenEmail})`))
    .returning(safeUserColumns);
  if (verified) return verified;

  // 2. token == staged pending -> commit the swap; the email unique index is the arbiter (23505 if taken since)
  const [committed] = await db
    .update(users)
    .set({ email: sql`${users.pendingEmail}`, emailVerified: true, pendingEmail: null })
    .where(and(
      eq(users.id, id),
      isNotNull(users.pendingEmail),
      sql`lower(${users.pendingEmail}) = lower(${tokenEmail})`,
    ))
    .returning(safeUserColumns);
  return committed || undefined; // neither branch -> undefined (stale token)
}
```

The route's send policy mirrors `register`: always stage + always look up the
target (equalized awaited work) + always return the neutral body, but email the
verification **link** only when the target is **unregistered** — never send a
"verify your email" link to an address that already belongs to another account
(it would reach a third party and 23505 at commit anyway). The verify helper
catches the commit-time 23505 and returns `false` so the rare race degrades to a
clean neutral failure, not a 500.

## Exceptions

- **Fail-open (no verification provider configured).** When there is no
  round-trip to commit a staged value (e.g. `RESEND_API_KEY` absent in dev), a
  staging column can never be committed — keep the immediate mutation on that
  path, and clear any stale staged value when you do.
- **Adding the staging column touches the read path.** If the column joins a
  broad column set (`getTableColumns(users)` minus password) it lands on the
  `SELECT` used by login/user reads — a missed prod migration is then a `42703`
  **auth outage**, not a graceful feature break. Verify-applied before merge per
  the Railway migrate-before-merge ordering (`server:prod` runs no `db:push`).

## Related Files

- `server/storage/users.ts` — `stagePendingEmail`, `applyEmailVerification`,
  `updateUserEmail` (fail-open path clears stale pending).
- `server/routes/auth.ts` — `POST /api/auth/change-email`,
  `applyVerificationToken` (catches commit-time 23505).
- `shared/schema.ts` — `users.pendingEmail` (nullable, intentionally no unique
  constraint) + `migrations/0010_users_pending_email.sql`.

## See Also

- [single-unique-column-23505-name-narrowing-reintroduces-enum-oracle](../logic-errors/single-unique-column-23505-name-narrowing-reintroduces-enum-oracle-2026-06-24.md) — the immediate-mutation catch's complement: branch on `isUniqueViolation` alone for a single-unique-column write.
- [multi-unique-column-23505-needs-constraint-name](../logic-errors/multi-unique-column-23505-needs-constraint-name-2026-06-18.md) — when a 23505 catch DOES need the constraint name (multiple unique columns).
- [anti-enum-equalize-awaited-work-before-existence-check](../logic-errors/anti-enum-equalize-awaited-work-before-existence-check-2026-06-19.md) — anti-enum requires equalizing awaited work, not just the response body.
