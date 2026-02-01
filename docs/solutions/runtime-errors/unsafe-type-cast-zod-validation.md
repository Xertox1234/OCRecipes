---
title: "Unsafe Type Cast - Use Zod Validation Instead of 'as'"
category: runtime-errors
tags: [typescript, zod, type-safety, validation, database]
module: server
symptoms:
  - Runtime crashes with "Cannot read property of undefined"
  - Type errors not caught at compile time
  - Invalid database values causing unexpected behavior
created: 2026-02-01
severity: high
---

# Unsafe Type Cast - Use Zod Validation Instead

## Problem

The subscription status retrieval used a TypeScript `as` cast to assert the database value was a valid `SubscriptionTier`. This bypasses runtime validation, allowing invalid values to crash the application.

## Symptoms

- Runtime errors when database contains unexpected values
- TypeScript gives false confidence that types are correct
- No graceful handling of data corruption or migration issues
- Difficult to debug because "types look correct"

## Root Cause

TypeScript's `as` keyword is a compile-time assertion that tells the compiler "trust me, this is type X." It provides zero runtime validation.

```typescript
// BEFORE (unsafe - no runtime validation)
async getSubscriptionStatus(userId: string) {
  const [user] = await db.select({
    tier: users.subscriptionTier,
    expiresAt: users.subscriptionExpiresAt,
  }).from(users).where(eq(users.id, userId));

  if (!user) return undefined;

  // DANGEROUS: What if user.tier is "invalid" or null?
  // TypeScript won't catch this at runtime!
  return {
    tier: user.tier as SubscriptionTier,  // Could be anything!
    expiresAt: user.expiresAt,
  };
}
```

If the database contains `tier: "bronze"` (invalid), the code happily passes it through. Downstream code expecting `"free" | "premium"` will break.

## Solution

Use Zod's `safeParse` to validate data at runtime with a fallback for invalid values.

```typescript
// AFTER (safe - runtime validation with fallback)
import { subscriptionTierSchema } from "@shared/types/premium";

async getSubscriptionStatus(userId: string) {
  const [user] = await db.select({
    tier: users.subscriptionTier,
    expiresAt: users.subscriptionExpiresAt,
  }).from(users).where(eq(users.id, userId));

  if (!user) return undefined;

  // Validate with Zod - graceful fallback if invalid
  const parsedTier = subscriptionTierSchema.safeParse(user.tier);

  return {
    tier: parsedTier.success ? parsedTier.data : "free",  // Safe fallback
    expiresAt: user.expiresAt,
  };
}
```

## The Pattern

```typescript
// Define schema once
const subscriptionTierSchema = z.enum(["free", "premium"]);

// Use safeParse for external data
const result = subscriptionTierSchema.safeParse(untrustedValue);

if (result.success) {
  // result.data is typed as SubscriptionTier
  return result.data;
} else {
  // Handle invalid data gracefully
  console.warn("Invalid tier:", untrustedValue, result.error);
  return "free"; // Sensible default
}
```

## When to Use Each Approach

| Source             | Approach                   | Example                        |
| ------------------ | -------------------------- | ------------------------------ |
| Database queries   | `safeParse` with fallback  | User preferences, settings     |
| API responses      | `safeParse` or `parse`     | Third-party APIs               |
| Request bodies     | `parse` (throw on invalid) | Form submissions               |
| Internal functions | Type annotations           | Passing data between functions |
| Type narrowing     | Type guards                | `if (isSubscriptionTier(x))`   |

## Prevention

1. **Rule**: Never use `as` for data from external sources (database, APIs, user input)
2. **Pattern**: Define Zod schemas alongside TypeScript types
3. **Pattern**: Use `safeParse` when you want to handle errors gracefully
4. **Pattern**: Use `parse` when invalid data should throw (e.g., request validation)

```typescript
// shared/types/premium.ts - Define both together
import { z } from "zod";

export const subscriptionTierSchema = z.enum(["free", "premium"]);
export type SubscriptionTier = z.infer<typeof subscriptionTierSchema>;

// Type guard for manual checks
export function isSubscriptionTier(value: unknown): value is SubscriptionTier {
  return subscriptionTierSchema.safeParse(value).success;
}
```

## Related Files

- `server/storage.ts:252-257` - Fixed implementation
- `shared/types/premium.ts` - Zod schema and type definitions
- `docs/PATTERNS.md:169-271` - Type Guards for Runtime Validation

## See Also

- [Zod Documentation](https://zod.dev/)
- [TypeScript: Type Assertions](https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#type-assertions)
