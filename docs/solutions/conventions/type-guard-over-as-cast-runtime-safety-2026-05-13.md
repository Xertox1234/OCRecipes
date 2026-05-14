---
title: "Type guard over `as` cast for runtime safety on external input"
track: knowledge
category: conventions
tags: [typescript, type-safety, type-guards, zod, validation]
module: shared
applies_to:
  ["server/**/*.ts", "client/**/*.ts", "client/**/*.tsx", "shared/**/*.ts"]
created: 2026-05-13
---

# Type guard over `as` cast for runtime safety on external input

## Rule

Never use `as TypeName` to assert a value's type when the value comes from external input (database, API, user input). Always use a type guard function that performs a runtime check.

## Examples

```typescript
// Bad: Unsafe cast — silently accepts invalid values
const tier = subscription?.tier || "free";
const features = TIER_FEATURES[tier as SubscriptionTier];
// If tier is "invalid_value", this indexes into TIER_FEATURES with a bad key
// and returns undefined — causing runtime errors downstream

// Good: Type guard with fallback
function isValidSubscriptionTier(tier: string): tier is SubscriptionTier {
  return (subscriptionTiers as readonly string[]).includes(tier);
}

const tier = subscription?.tier || "free";
const features = TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
// Invalid tiers safely fall back to "free" — no runtime surprises
```

## When this applies

- Any value from the database, API response, or user input that needs to be narrowed to a union type
- Enum-like `text()` columns in Drizzle (which return `string`, not the union type)
- Route parameters, query strings, or `req.body` fields

## Exceptions

- Values already validated by Zod schemas (Zod narrows the type correctly)
- Compile-time-only type narrowing where the value is known at build time

## Why

`as SubscriptionTier` tells TypeScript "trust me, this is valid" but performs zero runtime checking. If the database contains a value not in the union (e.g., from a migration), the cast silently produces a value that TypeScript considers valid but JavaScript cannot use correctly.

## Related Files

- `shared/types/premium.ts` — `isValidSubscriptionTier()` type guard, `subscriptionTiers` tuple, and `SubscriptionTier` type (type guard is colocated with the source array it validates)

## See Also

- [Unsafe type cast — use Zod validation instead](../runtime-errors/unsafe-type-cast-zod-validation.md)
