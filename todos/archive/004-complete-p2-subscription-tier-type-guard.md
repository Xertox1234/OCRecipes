---
status: complete
priority: p2
issue_id: "004"
tags: [type-safety, backend, bug-prevention]
dependencies: []
---

# Fix unsafe type assertion for subscription tier

## Problem Statement

`user.subscriptionTier as keyof typeof SUBSCRIPTION_TIERS` is an unsafe type assertion that could throw at runtime if the tier value is invalid or unexpected.

## Findings

- Location: `server/routes.ts`
- Unsafe cast: `user.subscriptionTier as keyof typeof SUBSCRIPTION_TIERS`
- No validation that tier value is actually a valid key
- Could cause runtime errors with corrupted data

## Proposed Solutions

### Option 1: Use type guard function

- **Pros**: Type-safe, handles edge cases gracefully
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

```typescript
function isValidTier(tier: string): tier is keyof typeof SUBSCRIPTION_TIERS {
  return tier in SUBSCRIPTION_TIERS;
}

const tier = isValidTier(user.subscriptionTier)
  ? user.subscriptionTier
  : "free";
```

## Recommended Action

Implement Option 1 - add type guard with fallback to 'free' tier.

## Technical Details

- **Affected Files**: `server/routes.ts`
- **Related Components**: Subscription/premium feature checks
- **Database Changes**: No

## Resources

- Original finding: Code review (kieran-typescript-reviewer)
- Pattern reference: `docs/PATTERNS.md` (type guards section)

## Acceptance Criteria

- [ ] Type guard function `isValidTier` created
- [ ] All subscription tier assertions replaced with type guard
- [ ] Invalid tiers default to 'free'
- [ ] No `as` type assertions for subscription tier
- [ ] Tests pass
- [ ] Code reviewed

## Work Log

### 2026-02-01 - Approved for Work

**By:** Claude Triage System
**Actions:**

- Issue approved during triage session
- Status: ready
- Ready to be picked up and worked on

**Learnings:**

- Avoid `as` type assertions; use type guards instead
- Always have a safe fallback for user-controlled data

## Notes

Source: Triage session on 2026-02-01
