---
title: A 23505 catch on a table with multiple unique columns must branch on the constraint name
track: bug
category: logic-errors
module: server
severity: low
tags: [drizzle, postgres, unique-constraint, error-handling, auth, conflict-409]
symptoms: [A 409 conflict returns the wrong field's message (e.g. 'Username already exists' when the email collided), 'Only reproduces under a concurrent-insert race (both requests pass the pre-check, one loses the unique insert)', Status code is correct (409); only the message body is wrong]
applies_to: [server/routes/**/*.ts, server/lib/db-errors.ts]
created: '2026-06-18'
---

# A 23505 catch on a table with multiple unique columns must branch on the constraint name

## Problem

A register route caught the Postgres unique violation (`23505`) from the
concurrent-insert race and always returned `"Username already exists"`:

```ts
} catch (err) {
  if (isUniqueViolation(err)) {
    return sendError(res, 409, "Username already exists", ErrorCode.CONFLICT);
  }
  throw err;
}
```

This was correct when `users` had a single unique column. After a second unique
column (`email`) was added, a concurrent registration that loses the race on the
**email** index hits the same catch and still reports the **username** message.

## Symptoms

- A 409 carries the wrong per-field message (username vs email).
- Only under a race: both pre-checks (`getUserByUsername` / `getUserByEmail`)
  pass, then a concurrent insert wins one of the unique indexes.
- The pre-check path (the common, non-concurrent case) is correct — only the
  catch is wrong.

## Root Cause

`isUniqueViolation(err)` is a **boolean** — it detects `23505` (on `err.code`
and the drizzle-wrapped `err.cause.code`) but cannot say **which** constraint
fired. With one unique column the message could be hardcoded; with two it is
ambiguous.

## Solution

Extract the violated constraint name (same `code`/`.cause` dual-check shape) and
branch the message on it:

```ts
// server/lib/db-errors.ts
export function uniqueViolationConstraint(err: unknown): string | undefined {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  } | null;
  if (e?.code === "23505") return e.constraint;
  if (e?.cause?.code === "23505") return e.cause.constraint;
  return undefined;
}

// route catch
if (isUniqueViolation(err)) {
  const constraint = uniqueViolationConstraint(err);
  return sendError(
    res,
    409,
    constraint?.includes("email")
      ? "Email already registered"
      : "Username already exists",
    ErrorCode.CONFLICT,
  );
}
```

The `?? undefined` fallback preserves the legacy message when the driver does
not surface a constraint name (older mocks / wrapped errors), so existing
username-race tests stay green.

## Prevention

When a table gains a second (or third) unique column, audit every `23505` /
`isUniqueViolation` catch that hardcodes one column's message — the catch cannot
distinguish columns by `code` alone. Add a race test per unique column that
mocks the wrapped error with the specific `constraint` name. Note the message
may never reach the UI (e.g. a client that collapses all register failures to
generic copy), so this is low-severity, but the API contract is still wrong.

## Related Files

- `server/lib/db-errors.ts` — `isUniqueViolation`, `uniqueViolationConstraint`
- `server/routes/auth.ts` — register route catch
- `server/routes/__tests__/auth.test.ts` — username-race + email-race tests

## See Also

- [Adding a NOT NULL column to a shared table — blast-radius checklist](../best-practices/adding-not-null-column-to-shared-table-blast-radius-2026-06-18.md) — the broader ripple of the same email-column change
