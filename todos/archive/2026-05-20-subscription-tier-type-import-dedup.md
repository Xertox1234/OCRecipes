---
title: "Import SubscriptionTier in auth.ts instead of re-inlining the union"
status: done
priority: low
created: 2026-05-20
updated: 2026-05-20
assignee:
labels: [deferred, typescript]
github_issue:
---

# Import SubscriptionTier in auth.ts instead of re-inlining the union

## Summary

`shared/types/auth.ts:14` declares `subscriptionTier?: "free" | "premium"`,
re-inlining the union that `@shared/types/premium` already exports as
`SubscriptionTier`. Import the shared type instead (the `MeasurementUnit` import
two lines above is the correct pattern).

## Background

Found in the 2026-05-20 full audit (L7). Minor DRY/drift risk: if a third tier is
ever added to `subscriptionTiers`, the inlined union silently diverges.

## Acceptance Criteria

- [ ] `auth.ts` imports `SubscriptionTier` from `@shared/types/premium`
- [ ] `User.subscriptionTier` typed as `SubscriptionTier` (optional preserved)
- [ ] `npm run check:types` clean — **first confirm `SubscriptionTier` resolves to
      exactly `"free" | "premium"`**; if it has more members the swap widens
      `User.subscriptionTier`, which may need call-site review

## Implementation Notes

File: `shared/types/auth.ts`. Verify `subscriptionTiers` in
`@shared/types/premium` before swapping — a wider union changes the `User` type.

## Risks

- If `SubscriptionTier` is wider than `"free" | "premium"`, consumers narrowing on
  it could break — check before committing.

## Updates

### 2026-05-20

- Initial creation (deferred from 2026-05-20 full audit, finding L7).
