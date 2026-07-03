---
title: parseInt on req.userId returns NaN
track: bug
category: runtime-errors
module: server
severity: high
tags: [auth, uuid, parseint, zod, type-coercion]
symptoms: [Zod z.number() validation fails on every authenticated request, 500 error on routes that parse `req.userId`, TypeScript happy because parseInt returns number — but NaN is a number]
applies_to: [server/routes/**/*.ts]
created: '2026-04-28'
---

# parseInt on req.userId returns NaN

## Problem

`req.userId` is always a UUID string set by the JWT middleware. A route in `verification.ts` called `parseInt(req.userId, 10)` — almost certainly copied from an era when user IDs were integers. `parseInt("uuid-string")` returns `NaN`, which Zod's `z.number()` schema rejects, producing a 500 error on every front-label confirm request. The bug produced no TypeScript error because `parseInt` has return type `number`, and `NaN` is a `number`.

## Symptoms

- Endpoint returns 500 on every request from authenticated users
- Zod validation error references the user-id field
- Logs show `userId: NaN` going into the storage layer

## Root Cause

UUIDs are non-numeric strings. `parseInt("abc-123-...")` returns `NaN` because the first character is non-numeric. TypeScript treats `NaN` as a valid `number`, so the cast type-checks despite being wrong at runtime.

## Solution

Change the Zod field to `z.string()` and remove the `parseInt` call:

```typescript
// Bad — parseInt on a UUID is always NaN
const schema = z.object({ userId: z.number() });
const userId = parseInt(req.userId!, 10);

// Good — UUID is a string
const schema = z.object({ userId: z.string().uuid() });
const userId = req.userId!;
```

## Prevention

Never call `parseInt()` on `req.userId` — it is a UUID string. Add a project-wide lint or grep rule to catch `parseInt(req.userId` and `Number(req.userId)`.

## Related Files

- `server/routes/verification.ts`
- Audit 2026-04-28 H2
