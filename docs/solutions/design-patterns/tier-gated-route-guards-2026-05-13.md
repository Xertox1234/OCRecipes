---
title: Tier-gated route guards
track: knowledge
category: design-patterns
module: server
tags: [api, premium, tiers, authorization, routes]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# Tier-gated route guards

## When this applies

When a route's behavior varies by subscription tier — premium-only access, different daily quotas for free vs premium, tier-dependent parameter constraints (e.g. extended meal plan date range).

## Why

`requireAuth` confirms a user is signed in. It does not enforce subscription policy. Tier gates must read `TIER_FEATURES[tier]` early in the handler, before any expensive work, and return a typed `code` that the client `ApiError` class can match on.

## Examples

```typescript
// Premium-only feature gate
const subscription = await storage.getSubscriptionStatus(req.userId!);
const tier = subscription?.tier || "free";
const features = TIER_FEATURES[tier];

if (!features.aiMealSuggestions) {
  res.status(403).json({
    error: "AI meal suggestions require a premium subscription",
    code: "PREMIUM_REQUIRED",
  });
  return;
}

// Tier-dependent limit gate
const dailyCount = await storage.getDailyMealSuggestionCount(
  req.userId!,
  new Date(),
);
if (dailyCount >= features.dailyAiSuggestions) {
  res.status(429).json({
    error: "Daily AI suggestion limit reached",
    code: "DAILY_LIMIT_REACHED",
    remainingToday: 0,
  });
  return;
}

// Tier-dependent parameter constraint
const maxDays = features.extendedPlanRange ? 90 : 7;
if (daysDiff > maxDays) {
  res.status(403).json({
    error: `Date range limited to ${maxDays} days on ${tier} plan`,
    code: "DATE_RANGE_LIMIT",
  });
  return;
}
```

## Key elements

1. **Fail-fast order**: validation → auth → tier gate → business logic. Tier checks go after auth but before expensive operations.
2. **Return typed `code` strings** the client `ApiError` class can match on.
3. **Use 403 for feature locks, 429 for usage limits, 400 for hard resource ceilings.**
4. **Default to `"free"`** when subscription data is missing — never grant premium by default.
5. **All numeric limits must come from `TIER_FEATURES`** — never hardcode a number (like `6` for max saved items). Hardcoded values silently drift from the config when tier limits change.

## Exceptions

- Auth-only gates → use `requireAuth` middleware
- Rate limiting for abuse prevention → use `express-rate-limit` middleware

## Related Files

- `server/routes.ts` — meal suggestion, grocery list creation routes
- `shared/types/premium.ts` — `TIER_FEATURES` config object, `PremiumFeatures` interface

## See Also

- [checkPremiumFeature helper for tier gates](check-premium-feature-helper-2026-05-13.md)
- [Premium-gate parity across endpoints hitting expensive AI paths](../conventions/premium-gate-parity-expensive-ai-paths-2026-05-13.md)
- [API error response structure](../conventions/api-error-response-structure-2026-05-13.md)
