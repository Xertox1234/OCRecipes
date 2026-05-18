---
title: "resolveSubscriptionTierFeatures ignores premium-expiry — may serve premium features to expired users"
status: backlog
priority: medium
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, security]
github_issue:
---

# resolveSubscriptionTierFeatures ignores premium-expiry

## Summary

`resolveSubscriptionTierFeatures()` in `server/services/subscription-tier-cache.ts`
resolves the user's tier straight from the stored `subscription.tier` without the
premium-expiry check that the `GET /api/subscription/status` route applies. If an
expired-premium user's DB row still reads `tier: "premium"`, server-side feature
gating that relies on this resolver would grant premium features the user no
longer pays for.

## Background

Flagged during the PR #224 review (verification streak premium unlocks). The
streak work was deliberately scoped to NOT touch this — it is a pre-existing
issue, surfaced here for tracking.

Two feature-resolution paths handle expiry differently:

- `server/routes/subscription.ts` (~lines 48-54) computes
  `isActive = tier === "free" || (tier === "premium" && (!expiresAt || new
Date(expiresAt) > new Date()))` and downgrades to
  `effectiveTier = isActive ? tier : "free"` — **expiry-aware**.
- `server/services/subscription-tier-cache.ts` `resolveSubscriptionTierFeatures()`
  does `const tier = subscription?.tier ?? "free"` with **no expiry check**, then
  feeds that into `TIER_FEATURES` / `applyStreakUnlocks`. This resolver backs
  server-side premium gating (e.g. the recipe-generation gate it was extracted
  from — see the file's header comment).

If premium lapses, the resolver could serve premium `TIER_FEATURES` for up to the
60s cache TTL on every cache-miss window — indefinitely, since it always reads
the stale tier.

## Acceptance Criteria

- [ ] **First, confirm whether this is a real bug.** Determine whether an expired
      premium subscription leaves `tier: "premium"` in the DB (with a past
      `expiresAt`), or whether some process downgrades the stored `tier` to `"free"`
      on expiry. If the stored tier is reliably downgraded on expiry, this is a
      false positive — close the todo with that finding, no code change.
- [ ] If the stored tier is NOT downgraded on expiry: make
      `resolveSubscriptionTierFeatures()` apply the same expiry check as
      `subscription.ts` — treat an expired-premium subscription as `"free"` before
      resolving features. Extract the expiry/`effectiveTier` logic into a shared
      helper so the route and the resolver cannot drift again.
- [ ] Add a unit test: an expired-premium subscription resolves to free-tier
      features through `resolveSubscriptionTierFeatures()`.

## Implementation Notes

- Files: `server/services/subscription-tier-cache.ts` (the resolver),
  `server/routes/subscription.ts` (the canonical expiry logic to share).
- Investigation starting points: how subscriptions are written/expired —
  `storage.getSubscriptionStatus`, the IAP receipt-validation flow
  (`server/services/receipt-validation.ts`), and any scheduled/lazy expiry job.
- If a shared helper is extracted, keep it pure and colocated with the premium
  types or the subscription storage module.

## Dependencies

- None.

## Risks

- This is an entitlement/gating concern — verify the fix does not over-correct
  (e.g. downgrading an active premium user mid-session). The expiry comparison
  must match `subscription.ts` exactly.

## Updates

### 2026-05-18

- Initial creation (PR #224 review follow-up).
