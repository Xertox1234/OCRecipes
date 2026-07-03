---
title: Expired-premium tier not downgraded before TIER_FEATURES lookup (systemic revenue leak)
track: bug
category: logic-errors
module: server
severity: high
tags: [security, premium, subscription, revenue, tier-resolution]
symptoms: [A user whose premium subscription lapsed still has paid features / higher limits, 'GET /api/subscription/status reports free, but a gated route still grants premium', extendedPlanRange / pantryTracking / maxSavedItems / maxFavouriteRecipes don't drop after expiry]
created: '2026-05-25'
last_updated: '2026-05-26'
---

# Expired-premium tier not downgraded before TIER_FEATURES lookup (systemic revenue leak)

## Problem

`users.subscriptionTier` is **not reset to `free` when a subscription expires** — it stays `premium` and `subscriptionExpiresAt` moves into the past. Multiple call sites indexed `TIER_FEATURES[storedTier]` directly with that raw tier, so a lapsed subscriber kept every paid feature and elevated limit indefinitely. The defensive helper `resolveEffectiveTier(tier, expiresAt)` existed and was used by `GET /api/subscription/status` and the `subscription-tier-cache` resolver, but the actual enforcement paths bypassed it — a documented "these cannot drift" invariant that had silently drifted.

## Symptoms

- Lapsed-premium user keeps AI chat, recipe generation, meal-suggestions, etc. (route gates).
- Same user keeps `maxSavedItems` / `maxFavouriteRecipes` premium limits (storage limit checks).
- Same user keeps the 90-day grocery range + pantry deduction (`grocery.ts` inline reads).

## Root Cause

`resolveEffectiveTier` was applied inconsistently. Found in 4 places using the raw stored tier:

- `server/routes/_helpers.ts` `getPremiumFeatures` → backs `checkPremiumFeature` for ~28 routes.
- `server/storage/nutrition.ts` `maxSavedItems` limit check.
- `server/storage/favourite-recipes.ts` `maxFavouriteRecipes` limit check.
- `server/routes/grocery.ts` `extendedPlanRange` range + `pantryTracking`.

The B2B `ApiTier` sites (`api-rate-limit.ts`, `public-api.ts`) use an api-key tier with no expiry concept and are correctly exempt.

## Solution

**Primary path (added in follow-up todo, 2026-05-26):** call `storage.getEffectiveTierForUser(userId)` — a cache-free, single-storage-call helper defined in `server/storage/users.ts` that selects `subscriptionTier + subscriptionExpiresAt` and applies `resolveEffectiveTier` internally, returning the effective tier directly:

```ts
const effectiveTier = await storage.getEffectiveTierForUser(userId);
const features = TIER_FEATURES[effectiveTier];
```

**Inline fallback (still valid in niche cases):** when a subscription record is already in hand from a non-helper read (e.g. `GET /api/subscription/status`), apply `resolveEffectiveTier` inline rather than re-fetching:

```ts
const storedTier = subscription?.tier ?? "free";
const { effectiveTier } = resolveEffectiveTier(
  isValidSubscriptionTier(storedTier) ? storedTier : "free",
  subscription?.expiresAt ?? null,
);
const features = TIER_FEATURES[effectiveTier];
```

**Do NOT** "fix" per-request route gates by routing `getPremiumFeatures` through the cached `resolveSubscriptionTierFeatures` resolver. That was the first attempt and it broke ~20 route test suites: the resolver also calls `storage.getUserVerificationStats` (which those tests don't mock → `stats.streak` throws → 500) and holds a 60s module-singleton `tierCache` that leaks resolved features across tests. Use `getEffectiveTierForUser` (or inline `resolveEffectiveTier`) on the gate path; reserve the cached resolver for the genuinely cache-friendly `/status` + generation-banner paths.

## Prevention

- `docs/rules/security.md`: "Never index `TIER_FEATURES[tier]` for a user subscription with the raw stored tier — resolve effective tier first." Recommends `storage.getEffectiveTierForUser(userId)` as the primary path.
- `code-reviewer.md` + `security-auditor.md`: flag any `TIER_FEATURES[rawTier]` lacking `getEffectiveTierForUser`/`resolveEffectiveTier` (user subs); exempt `ApiTier`. Also flag new inline `select tier + expiresAt + resolveEffectiveTier` blocks that could use the helper.
- Done (2026-05-26): a single `storage.getEffectiveTierForUser(userId)` storage helper now exists in `server/storage/users.ts`, making the rule enforceable by construction. All four original call sites migrated.

## Related Files

- `server/routes/_helpers.ts`, `server/storage/nutrition.ts`, `server/storage/favourite-recipes.ts`, `server/routes/grocery.ts`
- `shared/types/premium.ts` (`resolveEffectiveTier`, `applyStreakUnlocks`, `TIER_FEATURES`)
- `server/services/subscription-tier-cache.ts` (`resolveSubscriptionTierFeatures` — the cache-friendly path)

## See Also

- Audit manifest 2026-05-25 (findings H3, H4).
- Discovery-process note: the specialist agents reviewed the *changed lines* of `nutrition.ts`/`favourite-recipes.ts` but did not pattern-match the *unchanged* `TIER_FEATURES[rawTier]` indexer in those files — file-scoped audit prompts miss systemic bugs living in unchanged code of changed files.
