---
title: Exclude sensitive columns from default queries
track: knowledge
category: conventions
module: server
tags: [security, storage, drizzle, password-hash, information-disclosure]
applies_to: [server/storage/users.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# Exclude sensitive columns from default queries

## Rule

Storage functions that return user records should exclude password hashes (and other secrets) by default. Create a `safeUserColumns` object that omits the `password` column using destructuring, and provide separate `ForAuth` variants for the rare login/delete flows that need it.

## Examples

```typescript
// ❌ BAD: password hash leaks to every caller
async function getUser(id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

// ✅ GOOD: default query excludes password
const { password: _, ...safeUserColumns } = getTableColumns(users);
type SafeUser = InferSelectModel<typeof users> & { password?: never };

async function getUser(id: number): Promise<SafeUser | undefined> {
  const [user] = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.id, id));
  return user as SafeUser | undefined;
}

// Only for login / account-deletion flows
async function getUserForAuth(id: number): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}
```

## When to use

Any storage function returning rows from tables that contain password hashes, API keys, or other secrets.

## Why

Defence-in-depth — even if a route accidentally serialises the full object into a response, the secret is never present.

## Related Files

- `server/storage/users.ts` — `safeUserColumns`, `getUser()`, `getUserForAuth()`

## See Also

- [PII stripping in API response serialization](../design-patterns/pii-stripping-api-response-serialization-2026-05-13.md)
- [Mass-assignment protection: whitelist updatable fields](mass-assignment-protection-whitelist-fields-2026-05-13.md)
