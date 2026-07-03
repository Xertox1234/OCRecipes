---
title: New recipe generation endpoint skipped quota check
track: bug
category: logic-errors
module: server
severity: critical
tags: [security, quota, premium, ai, rate-limiting, openai]
symptoms: [Free-tier users can hit OpenAI through a new recipe endpoint without quota check, Rate limiter alone caps requests-per-minute but not daily AI spend, Sibling endpoint enforces two-phase quota; new endpoint silently skips it]
applies_to: [server/routes/**/*.ts]
created: '2026-04-28'
---

# New recipe generation endpoint skipped quota check

## Problem

The cooking session recipe endpoint (`POST /api/cooking/sessions/:id/recipe`) was added alongside the established `POST /api/recipes/generate` but used `cookingPhotoRateLimit` (10/min) instead of `recipeGenerationRateLimit` (3/min) and had no premium quota check at all. The two-phase quota pattern — early `getDailyRecipeGenerationCount` fast path + atomic `logRecipeGenerationWithLimitCheck` post-AI call — was established specifically to prevent free-tier users from burning OpenAI budget. New AI endpoints that follow the "session flow" pattern are at risk of missing this gate because the session setup code appears complete even without the quota check.

## Symptoms

- Free-tier users can call a new recipe-generation endpoint at high frequency
- OpenAI spend grows linearly with traffic without a corresponding paid-tier conversion
- Audit reveals the missing `checkPremiumFeature` + quota path

## Root Cause

When adding a new AI endpoint via copy-paste from a session-flow template, the developer focuses on session orchestration logic and forgets to copy the quota path from the canonical recipe-generation endpoint. Rate-limiting alone is not sufficient — a free-tier user can call at 3/min × N users and still burn significant budget.

## Solution

Every new recipe generation endpoint must use:

1. `recipeGenerationRateLimit` (the dedicated limiter, not `cookingPhotoRateLimit` or any other shared one)
2. `checkPremiumFeature(req, "recipeGeneration")` early in the handler
3. `getDailyRecipeGenerationCount(userId)` fast-path quota check before the AI call
4. `logRecipeGenerationWithLimitCheck(userId)` atomic counter increment after the AI call

```typescript
app.post(
  "/api/cooking/sessions/:id/recipe",
  requireAuth,
  recipeGenerationRateLimit, // dedicated limiter
  async (req, res) => {
    // 1. Premium feature gate
    const gate = await checkPremiumFeature(req, "recipeGeneration");
    if (!gate.allowed) return sendError(res, 403, gate.reason, { code: gate.code });

    // 2. Fast-path daily quota check
    const used = await getDailyRecipeGenerationCount(req.userId!);
    if (used >= gate.quota) return sendError(res, 429, "Daily limit reached");

    // 3. AI call
    const recipe = await generateRecipe(...);

    // 4. Atomic counter increment after success
    await logRecipeGenerationWithLimitCheck(req.userId!);

    res.json(recipe);
  },
);
```

## Prevention

When introducing a new endpoint that hits the same expensive AI path, list every gating step from the canonical sibling and check them off explicitly. Add a checklist comment in the route file pointing at the four steps above.

## Related Files

- `server/routes/cooking.ts` — new endpoint
- `server/routes/recipes.ts` — canonical recipe-generation pattern
- Audit 2026-04-28 H1

## See Also

- [Premium gate parity expensive AI paths](../conventions/premium-gate-parity-expensive-ai-paths-2026-05-13.md)
- [Tier gated route guards](../design-patterns/tier-gated-route-guards-2026-05-13.md)
- [Early rejection before paid APIs](../design-patterns/early-rejection-before-paid-apis-2026-05-13.md)
