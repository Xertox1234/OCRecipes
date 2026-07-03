---
title: 'Storage return types: `undefined` for `not found`, never `null`'
track: knowledge
category: conventions
module: server
tags: [drizzle, storage, typescript, return-types, testing]
applies_to: [server/storage/**/*.ts, server/**/__tests__/**/*.ts]
created: '2026-05-13'
---

# Storage return types: `undefined` for "not found", never `null`

## Rule

Storage functions that look up a single record return `T | undefined` (not `T | null`) when the record doesn't exist. This is enforced by Drizzle's `result[0]` pattern which yields `undefined` for empty results.

## Examples

```typescript
// Storage implementation
export async function getUser(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user; // undefined if not found
}

// ✅ Test mock: undefined for "not found"
vi.mocked(storage.getUser).mockResolvedValue(undefined);

// ❌ Wrong: null — doesn't match the return type
vi.mocked(storage.getUser).mockResolvedValue(null);
```

## Exceptions

Some storage functions explicitly return `null` for business-logic reasons (e.g., `createGroceryListWithLimitCheck` returns `null` when the limit is exceeded, `getApiKey` returns `T | null`). Check the storage function's return type before choosing `undefined` vs `null` in your mock.

## Why

Drizzle's `[firstRow] = await db.select()...` destructure yields `undefined` for empty result sets, not `null`. Aligning the public return type to that natural shape avoids a translation layer and keeps the contract consistent across all read-single functions.

## See Also

- [Typed mock factories for test data](typed-mock-factories-for-test-data-2026-05-13.md)
