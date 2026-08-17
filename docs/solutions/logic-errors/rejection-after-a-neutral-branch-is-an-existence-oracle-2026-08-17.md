---
title: A new rejection placed AFTER a neutral anti-enumeration branch turns the endpoint into an existence oracle
track: bug
category: logic-errors
tags: [security, api, auth, anti-enumeration, error-handling]
module: server
applies_to: ["server/routes/**", "server/storage/users.ts"]
symptoms: ["A registration/login endpoint returns a neutral 200 for one input pair and a specific 4xx for another, differing only in a field the neutral response is supposed to hide", "A rejection added at the storage layer surfaces through a route catch block placed later than an existing neutral branch", "Both the new rejection and the neutral response are individually correct, and every test passes"]
created: 2026-08-17
severity: critical
---

# A new rejection placed AFTER a neutral anti-enumeration branch turns the endpoint into an existence oracle

## Problem

`POST /api/auth/register` deliberately returns a **content-free neutral 200**
(`verification_pending`) whether or not the submitted email already has an
account, so the endpoint cannot be used to test whether an address is
registered. Three separate mechanisms exist for that one property: the neutral
response body, a **pre-paid bcrypt hash** computed before the email lookup so
both branches take the same wall-clock, and a `pendingEmail` column left
deliberately unconstrained.

Reserving the username `demo` was implemented at the storage choke point —
`createUser` throws `ReservedUsernameError` — and mapped to a 409 in the route's
`try/catch` around `storage.createUser(...)`. Both halves are individually
correct. But that catch sits **after** the email-existence branch, and
`createUser` is only reached when the email is free. So holding a reserved
username fixed and varying only the email produced two different answers:

```
{username:"DEMO", email:<already registered>} -> 200 {"status":"verification_pending"}
{username:"DEMO", email:<not registered>}     -> 409 {"error":"That username is reserved..."}
```

One request, no side effects, infinitely repeatable with the same username —
a strictly better oracle than the pre-existing 2-request one (register X against
the target, then register X again; a 409 means X was created, so the target was
free), which costs two requests, creates a junk account, and burns a username
per probe. An IP-keyed rate limiter blocks mass harvesting but not the actual
threat: one request answers "does `victim@company.com` have an account here".

**Why the case-folding is what makes it universal.** The reservation compares
`username.trim().toLowerCase()`, but `users.username` has a plain
case-SENSITIVE unique constraint — there is no `lower(username)` expression
index (only `migrations/0009_users_email_lower_unique.sql`, for email). So
`DEMO` **misses** the route's username-uniqueness pre-check in every
environment, seeded or not, while the case-folded reservation still rejects it.
The payload therefore works everywhere, not only where a `demo` row exists.

## Symptoms

- Every test passes. The differential is invisible to any test that does not
  hold one field fixed and vary the other — none did.
- Each half reviews as correct in isolation. The defect is purely **positional**.
- A code comment actively argued the position was safe: *"the reserved list is
  a fixed constant, so naming it leaks nothing about any account."* True about
  the response's **content**, false about its **presence vs. absence relative to
  the neutral path** — and very likely why the placement went unquestioned.

## Solution

Put the new rejection in the slot that is **already** non-neutral, not wherever
the error happens to surface. `server/routes/auth.ts` has exactly one such slot
by design — the username-uniqueness 409, whose own comment reads *"This is the
only signup response that is NOT the neutral check-inbox"*:

```ts
const existingUser = await storage.getUserByUsername(username);
if (existingUser) return sendError(res, 409, "Username already exists", ErrorCode.CONFLICT);

// Reserved names rejected HERE — deliberately BEFORE the email lookup below.
if (isReservedUsername(username)) {
  return sendError(res, 409, "That username is reserved. Please choose another.", ErrorCode.CONFLICT);
}
```

Both answers in that slot are **username-shaped**, so varying the email changes
nothing. Export the predicate and share it — a route that re-implements
`trim().toLowerCase()` can drift from storage and the differential returns.
Keep the storage-layer throw and its catch arm as defense-in-depth for
non-route callers; the choke point stays authoritative.

## Prevention

- **When adding any new rejection to an endpoint that anti-enumerates, ask where
  it sits relative to the neutral branch — not just whether its own status code
  and message are right.** Position is the whole property.
- **Test it as a differential, never as a single case.** Hold the sensitive
  field's *sibling* fixed at the value that triggers the new rejection, vary the
  sensitive field across present/absent, and assert the two responses are
  identical. Add a negative control with a non-triggering sibling value, or the
  assertion also passes when the endpoint is uniformly broken:

```ts
expect(taken.status).toBe(free.status);
expect(taken.body).toEqual(free.body);
```

- **Mutation-verify the pin.** Disabling the fix must make that test fail; if it
  stays green the test is a decoration. Verified here — removing the route check
  makes `expect(taken.status).toBe(free.status)` fail.
- A comment asserting "this leaks nothing" should say **what** it leaks nothing
  about. "The list is a fixed constant" answers a question nobody was asking.
- Two independent reviewers found this from different angles, and **both found
  it by constructing the request pair and running it** — neither by reading. On
  an endpoint with a stated security property, build the differential.

## Related Files

- `server/routes/auth.ts`
- `server/storage/users.ts`
- `server/routes/__tests__/auth.test.ts`
- `shared/schema.ts`
- `migrations/0009_users_email_lower_unique.sql`
