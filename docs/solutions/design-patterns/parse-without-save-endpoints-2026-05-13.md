---
title: Parse-without-save endpoints for AI/external preview flows
track: knowledge
category: design-patterns
module: server
tags: [api, routes, ai, preview, wizard, recipes]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# Parse-without-save endpoints for AI/external preview flows

## When this applies

Any flow where external data (AI, URL scraping, OCR, photo analysis) feeds into user-created records. The parse endpoint returns a preview; the user edits in a form/wizard; the existing create endpoint saves the final version.

## Why

- Users can review/edit before committing (wizard flow)
- Reduces wasted database writes from AI hallucinations or bad URL parses
- The client doesn't need separate "create from AI" vs "create from URL" mutations — all paths produce `ImportedRecipeData` and feed into the same save endpoint
- Easier to test: parse logic is tested independently from persistence

## Examples

```
# Parse/generate — returns data without saving
POST /api/meal-plan/recipes/generate   { prompt }           → ImportedRecipeData
POST /api/meal-plan/recipes/parse-url  { url }              → ImportedRecipeData

# Persist — saves to database (existing endpoint, unchanged)
POST /api/meal-plan/recipes            { title, ingredients, ... } → MealPlanRecipe
```

```typescript
// server/routes/recipe-generate.ts
app.post(
  "/api/meal-plan/recipes/generate",
  requireAuth,
  rateLimit,
  async (req, res) => {
    const { prompt } = parseBody(req.body);
    const content = await generateRecipeContent({ productName: prompt });

    // Convert to ImportedRecipeData — the shared preview format
    const result: ImportedRecipeData = {
      title: content.title,
      ingredients: content.ingredients.map(toParseIngredient),
      instructions: content.instructions,
      // ... other fields
      sourceUrl: "", // No source — AI generated
    };

    res.json(result); // Return without saving
  },
);
```

## Exceptions

Simple CRUD where the user provides all data directly — no intermediate preview needed.

## Related Files

- `server/routes/recipe-generate.ts`
- `server/routes/recipes.ts` (parse-url endpoint)
