---
title: "Tier Limits Have One Source of Truth — `TIER_FEATURES`"
track: knowledge
category: conventions
tags:
  [
    subscription,
    tier-limits,
    premium,
    config-drift,
    single-source-of-truth,
    magic-numbers,
  ]
module: shared
applies_to:
  [
    "server/storage/**/*.ts",
    "client/components/**/*.tsx",
    "client/screens/**/*.tsx",
    "shared/types/premium.ts",
  ]
created: 2026-05-13
---

# Tier Limits Have One Source of Truth — `TIER_FEATURES`

## Rule

Every tier-dependent limit (scans per day, suggestions per day, max saved
items, max recipes, etc.) lives in `TIER_FEATURES` in
`shared/types/premium.ts`. Server code reads it via `features.X`; client code
reads it via `features.X` from `usePremiumContext()`. No magic numbers
allowed in route handlers, storage methods, or screens.

## Smell patterns

- A literal number used in a tier-enforcement check
  (`if (savedItems.length >= 6)` instead of
  `if (savedItems.length >= features.maxSavedItems)`).
- The same number repeated in `storage.ts`, a screen, and a button component.
- A `// TODO: move to TIER_FEATURES` comment that's been sitting longer than
  one sprint.
- "Quick implementation" that hard-codes a limit until `TIER_FEATURES` "gets
  the field added."

## Why

Hardcoded tier limits silently drift from the centralized config:

- A magic number that "happens to match" `TIER_FEATURES` today still drifts
  later when someone changes the config and only the config — and the
  enforcement no longer matches the spec.
- The drift is invisible: code reads `TIER_FEATURES.X` somewhere and the
  feature appears to be wired to the config. The actual enforcement is
  hardcoded elsewhere and silently ignores config changes.
- Grep for the field name finds the reads but misses the magic number.

The discovery cost is high — usually a bug report from a user whose tier
upgrade didn't take effect, or a support escalation about a "broken" tier.

## Examples

### How the drift happens

The saved items limit was hardcoded as `6` in `storage.ts`,
`SavedItemsScreen.tsx`, and `SaveButton.tsx`. At the time the feature
shipped, `TIER_FEATURES` didn't have a `maxSavedItems` property yet. The
developer used a literal `6` as a quick implementation, intending to migrate
later.

Later, `TIER_FEATURES` became the canonical config for tier limits (scans,
suggestions, recipes), but the saved items limit was never migrated. The
hardcoded `6` continued to work correctly — it just wasn't connected to the
config system. Anyone changing `TIER_FEATURES.free.maxSavedItems` later
would have changed nothing.

### The full migration path

When adding a new tier-dependent limit:

1. **Add the field to the `PremiumFeatures` interface.**

   ```typescript
   interface PremiumFeatures {
     maxScansPerDay: number;
     maxSavedItems: number; // ← new field
     // ...
   }
   ```

2. **Set per-tier values in `TIER_FEATURES`.**

   ```typescript
   export const TIER_FEATURES: Record<SubscriptionTier, PremiumFeatures> = {
     free: { /* ... */ maxSavedItems: 6 },
     premium: { /* ... */ maxSavedItems: Infinity },
   };
   ```

3. **Consume via `features.X` everywhere.**

   ```typescript
   // Server
   if (savedItems.length >= features.maxSavedItems) {
     return sendError(res, 403, "Tier limit reached");
   }

   // Client
   const { features } = usePremiumContext();
   if (savedItems.length >= features.maxSavedItems) {
     /* ... */
   }
   ```

Never use a magic number as a "temporary" solution. It becomes permanent the
moment someone else reads the code and assumes the config is authoritative.

### Code-review gate

Grep for literal numbers when reviewing tier-related code:

```bash
git diff main -- 'server/**/*.ts' 'client/**/*.tsx' | grep -E '>= [0-9]+|< [0-9]+|=== [0-9]+'
```

Any hit on a tier check should reference `features.X`, not a literal.

## Exceptions

- **Truly invariant limits** that don't depend on tier (e.g., a hard
  database constraint on max title length). Those belong in a constants
  module, not `TIER_FEATURES`.
- **Test fixtures.** Tests can use literals to verify the rule fires at the
  expected boundary; the production code still reads from `TIER_FEATURES`.

## Related Files

- `shared/types/premium.ts` — `PremiumFeatures` interface and
  `TIER_FEATURES` config.
- `client/context/PremiumContext.tsx` — `usePremiumContext()` exposes
  `features` to client code.

## See Also

- [check-premium-feature-helper](../design-patterns/check-premium-feature-helper-2026-05-13.md) —
  the helper that wraps tier-feature reads on the server.
- [paired-endpoints-equal-safeguards](paired-endpoints-equal-safeguards-2026-05-13.md) —
  another subscription-rollout convention from the same code-review pass.
- [match-existing-api-response-conventions](match-existing-api-response-conventions-2026-05-13.md) —
  third subscription-rollout convention.
