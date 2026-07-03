---
title: 'Anti-enumeration endpoints must equalize awaited work, not just the response body'
track: bug
category: logic-errors
module: server
severity: medium
tags: [security, anti-enumeration, timing-side-channel, bcrypt, auth]
symptoms: ['A signup / login / password-reset endpoint returns a byte-identical neutral response for existing vs non-existing accounts, but response latency differs measurably.', 'The new-account branch runs bcrypt or an INSERT that the existing-account branch short-circuits past — slow response = account was available, fast = already exists.']
applies_to: [server/routes/auth.ts]
created: '2026-06-19'
---

# Anti-enumeration endpoints must equalize awaited work, not just the response body

## Problem

Returning an identical neutral response **body** is not sufficient for
anti-enumeration. If the existing-account and new-account branches perform a
different amount of **awaited** work before responding, response *latency* leaks
which branch ran — re-opening the exact enumeration oracle the neutral body was
meant to close.

## Symptoms

- All outcomes return the same `200 { status: "verification_pending" }`, yet a
  timing probe distinguishes them.
- One branch awaits `bcrypt.hash(...)` (~250 ms) or a DB write; the sibling
  branch returns before reaching it.

## Root Cause

In the email-verification register flow, the new-account path awaited
`bcrypt.hash(password, 12)` (~250 ms, the dominant cost) and then `createUser`,
while both existing-email branches short-circuited at the
`getUserByEmail` check *before* any hashing. Fire-and-forget email sends were
already timing-flat, so bcrypt was the whole differential: a ~250 ms gap that is
trivially measurable in a handful of requests. Slow = email was free, fast =
email exists.

## Solution

Pay the dominant cost on **every** branch of the gated path, by moving it
*before* the existence check — gated on the feature flag so the non-anti-enum
(OFF) path stays fast:

```ts
const existingUser = await storage.getUserByUsername(username);
if (existingUser) return sendError(res, 409, ...); // username 409 is the accepted residual

// Equalize timing: when verification is ON, hash BEFORE the email lookup so the
// existing-email and new-account branches share the ~250ms bcrypt cost.
const precomputedHash = verificationOn ? await bcrypt.hash(password, 12) : null;

const existingEmail = await storage.getUserByEmail(email);
if (existingEmail) { /* ...neutral 200, never createUser... */ return sendVerificationPending(res); }

const hashedPassword = precomputedHash ?? (await bcrypt.hash(password, 12));
const user = await storage.createUser({ username, password: hashedPassword, email });
```

Pin the mitigation with a **deterministic** test — assert bcrypt was *called* on
the existing-account branch (`vi.spyOn(bcrypt, "hash")`), never a flaky
wall-clock assertion. A future perf "optimization" that strips the pre-hash then
fails CI instead of silently re-opening the oracle.

The residual `createUser` INSERT (~few ms) on the new path is accepted — equalize
the *dominant* term, don't chase milliseconds with a dummy insert.

## Prevention

When reviewing any "neutral response" endpoint, ask: **what does an
existing-vs-absent account change about WORK DONE (awaited), not just the
response shape?** Fire-and-forget sends are timing-flat; awaited bcrypt / DB
writes are not. A byte-identical body with a branch-dependent `await` is still an
oracle.

## Related Files

- `server/routes/auth.ts` — register handler (gated pre-hash)
- `server/routes/__tests__/auth.test.ts` — the `vi.spyOn(bcrypt, "hash")` pin

## See Also

- [auth gate on jwt claim strands pre-flip tokens](auth-gate-on-jwt-claim-strands-pre-flip-tokens-2026-06-19.md) — sibling auth-rollout lesson from the same feature
