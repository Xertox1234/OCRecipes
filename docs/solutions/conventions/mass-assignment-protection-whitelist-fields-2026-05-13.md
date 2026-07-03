---
title: 'Mass-assignment protection: whitelist updatable fields with Pick<>'
track: knowledge
category: conventions
module: server
tags: [security, mass-assignment, storage, drizzle, typescript]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Mass-assignment protection: whitelist updatable fields with Pick<>

## Rule

When a storage function accepts a partial update object and passes it to Drizzle's `.set()`, constrain the type to only the fields callers are allowed to modify. Never accept `Partial<TableRow>` — it allows setting sensitive columns like `role`, `password`, `email`, `tokenVersion`, or `subscriptionTier`.

## When to use

Any storage `update*()` function that accepts a caller-provided object and passes it to `.set()`.

## When NOT to use

Internal functions that build the update object entirely within the storage layer (e.g., `incrementTokenVersion` which uses a SQL expression, not caller input).

## Examples

```typescript
import type { User } from "@shared/schema";

// ❌ BAD: Accepts any User field — caller can set role, password, tokenVersion
export async function updateUser(
  id: string,
  updates: Partial<User>,
): Promise<User | undefined> {
  const [user] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning();
  return user || undefined;
}

// ✅ GOOD: Whitelist of safe fields via Pick<>
type UpdatableUserFields = Pick<
  User,
  | "displayName"
  | "avatarUrl"
  | "onboardingCompleted"
  | "dailyCalorieGoal"
  | "dailyProteinGoal"
  | "dailyCarbsGoal"
  | "dailyFatGoal"
  | "goalsCalculatedAt"
  | "weight"
  | "height"
  | "age"
  | "gender"
  | "goalWeight"
  | "adaptiveGoalsEnabled"
>;

export async function updateUser(
  id: string,
  updates: Partial<UpdatableUserFields>,
): Promise<User | undefined> {
  const [user] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, id))
    .returning();
  return user || undefined;
}
```

## Why Pick<> instead of Omit<>

`Omit<User, 'password' | 'role' | ...>` is a denylist — it silently allows any new column added to the schema. `Pick<>` is an allowlist — new columns are excluded by default and must be explicitly opted-in. Allowlists fail safe; denylists fail open.

## What about Zod validation at the route?

Route-level Zod schemas are the primary defense, but storage-layer types provide defense-in-depth. If a future code path calls `updateUser()` without route-level validation, the `Pick<>` type prevents the TypeScript compiler from accepting sensitive fields.

## Sensitive fields that must NEVER appear in an update whitelist

- `id` — primary key, immutable
- `password` — use dedicated `changePassword()` with bcrypt
- `role` — use dedicated admin-only `setRole()`
- `tokenVersion` — use atomic `incrementTokenVersion()` (SQL expression)
- `subscriptionTier`, `subscriptionExpiresAt` — set only by receipt validation
- `username` — immutable after creation
- `createdAt` — auto-generated, immutable

## Related Files

- `server/storage/users.ts` — `UpdatableUserFields`, `updateUser()`
- `docs/rules/security.md` — "Storage update functions must accept an explicit field whitelist"

## See Also

- [IDOR protection: auth + ownership check](idor-protection-auth-ownership-check-2026-05-13.md) (complementary — whitelist prevents privilege escalation, IDOR prevents cross-user access)
- [Input validation with Zod](input-validation-with-zod-2026-05-13.md)
- [Exclude sensitive columns from default queries](exclude-sensitive-columns-default-queries-2026-05-13.md)
