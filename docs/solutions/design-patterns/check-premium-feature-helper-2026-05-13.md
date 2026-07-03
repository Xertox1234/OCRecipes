---
title: checkPremiumFeature helper for tier gates
track: knowledge
category: design-patterns
module: server
tags: [api, premium, helper, dry, routes]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# checkPremiumFeature helper for tier gates

## When this applies

When 3+ routes share the same boolean premium-gating pattern (fetch subscription → resolve tier → check feature flag → send 403), extract a shared helper instead of duplicating the block in every handler.

## Why

Inline tier checks drift independently. One handler defaults `tier` to `"free"`, another to `null`. One uses `as SubscriptionTier`, another uses `isValidSubscriptionTier()`. A helper centralizes the fallback and type-guard so every gated route behaves identically.

## Examples

```typescript
/**
 * Check if the user has a premium feature. Returns the features object if granted,
 * or sends a 403 response and returns null if not.
 */
async function checkPremiumFeature(
  req: Request,
  res: Response,
  featureKey: keyof PremiumFeatures,
  featureLabel: string,
): Promise<PremiumFeatures | null> {
  const subscription = await storage.getSubscriptionStatus(req.userId!);
  const tier = subscription?.tier || "free";
  const features = TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
  if (!features[featureKey]) {
    res.status(403).json({
      error: `${featureLabel} requires a premium subscription`,
      code: "PREMIUM_REQUIRED",
    });
    return null;
  }
  return features;
}

// Usage in route handler — early return on null
app.get("/api/pantry", requireAuth, async (req, res) => {
  const features = await checkPremiumFeature(
    req,
    res,
    "pantryTracking",
    "Pantry tracking",
  );
  if (!features) return; // 403 already sent

  // features is PremiumFeatures — can check additional limits
  const items = await storage.getPantryItems(req.userId!);
  res.json(items);
});
```

## Key design choices

1. Returns `PremiumFeatures | null` rather than `boolean` so callers can use tier-dependent limits from the same object.
2. Uses `isValidSubscriptionTier()` type guard internally — never `as SubscriptionTier`.
3. Sends the 403 response itself — caller just checks for `null` and returns.

## Exceptions

- Routes that need tier-dependent **limits** (daily quotas, range limits) need custom logic after the feature check. You can still use `checkPremiumFeature` for the initial boolean gate and then use the returned `features` object for limit checks.
- Single-use gates where the overhead of a helper isn't justified.

## Related Files

- `server/routes.ts` — pantry, grocery, meal confirmation routes all use this

## See Also

- [Tier-gated route guards](tier-gated-route-guards-2026-05-13.md)
- [Premium-gate parity across endpoints hitting expensive AI paths](../conventions/premium-gate-parity-expensive-ai-paths-2026-05-13.md)
