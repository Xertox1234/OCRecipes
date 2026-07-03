---
title: Premium-gate parity across endpoints hitting expensive AI paths
track: knowledge
category: conventions
module: server
tags: [security, premium, rate-limiting, cost-control, openai, parity]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# Premium-gate parity across endpoints hitting expensive AI paths

## Rule

When multiple endpoints call the same expensive AI service (recipe generation, photo analysis, coach responses), every endpoint must enforce the same premium contract: `checkPremiumFeature(...)` + daily quota via `getDailyRecipeGenerationCount` (or equivalent). Rate-limiting alone (`recipeGenerationRateLimit`) is not sufficient — a free-tier user can still burn the OpenAI budget at 5 heavy calls/minute × N tenants.

## Examples

```typescript
// ❌ Bad: new endpoint has only a rate limit, unlike its sibling
app.post(
  "/api/meal-plan/recipes/generate",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 5 }),
  async (req, res) => {
    const content = await generateRecipeContent(...); // $0.05/call GPT-4
    res.json(content);
  },
);

// Meanwhile /api/recipes/generate enforces checkPremiumFeature +
// dailyRecipeGenerations and rejects free-tier calls before the AI fires.
```

```typescript
// ✅ Good: same contract as the existing premium endpoint
app.post(
  "/api/meal-plan/recipes/generate",
  requireAuth,
  recipeGenerationRateLimit, // shared limiter from ./_rate-limiters
  async (req, res) => {
    const features = await checkPremiumFeature(
      req, res, "recipeGeneration", "Recipe generation",
    );
    if (!features) return;

    const generationsToday = await storage.getDailyRecipeGenerationCount(
      req.userId, new Date(),
    );
    if (generationsToday >= features.dailyRecipeGenerations) {
      sendError(res, 429, "Daily recipe generation limit reached",
        ErrorCode.DAILY_LIMIT_REACHED);
      return;
    }

    const content = await generateRecipeContent(...);
    res.json(content);
  },
);
```

## Audit step for any new AI or external-quota endpoint

1. Grep `server/routes/` for sibling endpoints calling the same `generateX`/`analyzeX`/`chatX` service OR the same third-party client (Spoonacular, Runware, USDA-paid-tier, etc.).
2. Confirm the new endpoint imports from `./_helpers` (`checkPremiumFeature`, `handleRouteError`) and `./_rate-limiters` (not inline `rateLimit()`).
3. Confirm the daily-quota check runs BEFORE the AI/external call, not after.
4. **Include GET/read endpoints that hit external quotas, not just writes.** A `GET /catalog/search?q=...` that proxies to Spoonacular drains the same quota as `POST /catalog/save` — gate both. Premium parity is about "does this request cost money" not "does this request mutate state".

## Origin

2026-04-17 audit H2 — `POST /api/meal-plan/recipes/generate` (new endpoint supporting the recipe wizard) had only a 5/min inline `rateLimit`, while the existing `POST /api/recipes/generate` enforced `checkPremiumFeature("recipeGeneration")` + `dailyRecipeGenerations`. 2026-04-18 audit H7 extended the rule to read endpoints — commit `b663764` gated the POST siblings of catalog save / URL import but missed `GET /catalog/search` and `GET /catalog/:id`, which drain the same Spoonacular quota per call.

## Related Files

- `docs/rules/security.md` — "Premium-gate BOTH read AND write endpoints for premium features"

## See Also

- [Rate limiting on external API endpoints](../design-patterns/rate-limiting-external-api-endpoints-2026-05-13.md)
- [Early rejection before paid APIs](../design-patterns/early-rejection-before-paid-apis-2026-05-13.md)
