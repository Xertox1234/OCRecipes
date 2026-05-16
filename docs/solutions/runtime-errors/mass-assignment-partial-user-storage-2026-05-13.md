---
title: "Mass-Assignment via Partial<User> in Storage Update Functions"
track: bug
category: runtime-errors
tags:
  [
    security,
    mass-assignment,
    drizzle,
    typescript,
    privilege-escalation,
    storage,
  ]
module: server
applies_to: ["server/storage/users.ts", "server/storage/**/*.ts"]
symptoms:
  - "Storage update function accepts `Partial<TableRow>` including sensitive columns"
  - "Privilege-escalation surface exists at the storage layer even if routes validate"
  - "New columns added to the schema are silently accepted by update functions"
created: 2026-04-01
severity: critical
---

# Mass-Assignment via Partial<User> in Storage Update Functions

## Problem

The `updateUser()` storage function accepted `Partial<User>` — the full `User` type includes `password`, `role`, `tokenVersion`, `subscriptionTier`, `username`, and `createdAt`. Routes that called `updateUser()` passed Zod-validated input, so the route-level defense was sound. The storage function signature itself imposed no restriction. If any future route or code path forwarded unsanitized input to `updateUser()`, an attacker could escalate privileges (set `role`), hijack accounts (overwrite `password`), or bypass subscription checks (set `subscriptionTier: "premium"`). Drizzle's `.set()` applies whatever it receives — there is no ORM-level field filtering.

## Symptoms

- TypeScript compiles a call like `updateUser(id, { role: "admin" })` without error
- No runtime guard rejects sensitive-column writes
- New columns added to the `User` schema become writable everywhere by default

## Root Cause

This is the classic mass-assignment vulnerability adapted to the TypeScript / Drizzle stack. `Partial<User>` is a denylist-by-absence: every field on `User` is accepted. The danger is that TypeScript types don't distinguish "fields the user should control" from "fields the system should control." The type looks safe because `Partial<User>` _is_ a real type, just one whose shape happens to include sensitive columns.

## Solution

Replace `Partial<User>` with `Partial<UpdatableUserFields>`, where `UpdatableUserFields` is an explicit allowlist:

```typescript
type UpdatableUserFields = Pick<
  User,
  "displayName" | "avatarUrl" | "bio" | "preferences"
>;

async function updateUser(id: string, patch: Partial<UpdatableUserFields>) {
  return db.update(users).set(patch).where(eq(users.id, id));
}
```

`Pick<>` (allowlist) is correct because new columns added to the schema are excluded by default. Developers must explicitly opt new fields into the whitelist.

Sensitive columns are only modifiable through dedicated storage functions: `incrementTokenVersion`, `changePassword`, receipt-validation flow, etc.

## Prevention

- `Partial<T>` on a full table-row type is a mass-assignment vector. Treat it the same as accepting raw `req.body` — always narrow to only the fields the caller should control.
- Use `Pick<>` (allowlist), not `Omit<>` (denylist). Denylists fail open when new columns are added; allowlists fail closed.
- Route-level Zod is not enough. Storage-level types are defense-in-depth: a route that skips Zod cannot still escalate privileges.
- Audit all `Partial<TableRow>` signatures in the storage layer. If a function takes `Partial<InsertUserProfile>`, verify the insert schema omits sensitive fields, or add a `Pick<>`.

## Related Files

- `server/storage/users.ts` — `UpdatableUserFields` type, `updateUser()`
- `docs/legacy-patterns/security.md` — "Mass-Assignment Protection: Whitelist Updatable Fields"
- OWASP: [Mass Assignment](https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/)

## See Also

- [Mass-assignment protection whitelist fields](../conventions/mass-assignment-protection-whitelist-fields-2026-05-13.md)
- [Exclude sensitive columns from default queries](../conventions/exclude-sensitive-columns-default-queries-2026-05-13.md)
- [Storage-layer IDOR defense in depth](../conventions/storage-layer-idor-defense-in-depth-2026-05-13.md)
