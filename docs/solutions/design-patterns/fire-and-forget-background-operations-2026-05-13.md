---
title: "Fire-and-forget background operations after response"
track: knowledge
category: design-patterns
tags: [api, async, background, performance, routes]
module: server
applies_to: ["server/routes/**/*.ts", "server/services/**/*.ts"]
created: 2026-05-13
---

# Fire-and-forget background operations after response

## When this applies

When an operation needs to complete asynchronously but the client should receive an immediate response (e.g., image generation, async indexing, webhook notifications), trigger the background work **after** the HTTP response is sent using `void` and error suppression.

## Why

Image generation (5–30 seconds), search index updates, and webhook fan-out are slow operations that don't gate the client's next step. Awaiting them inside the handler turns a fast `POST /api/recipes` into a 30-second wait.

## Examples

```typescript
// Bad: Image generation blocks the response
app.post("/api/recipes", requireAuth, async (req, res) => {
  const recipe = await createRecipe(req.body);
  const imageUrl = await generateRecipeImage(recipe); // 5-30 seconds
  recipe.imageUrl = imageUrl;
  res.status(201).json(recipe);
  // Client waits 30+ seconds for response
});

// Good: Image generated async; client gets immediate response
app.post("/api/recipes", requireAuth, async (req, res) => {
  const recipe = await createRecipe(req.body);
  res.status(201).json({ ...recipe, imageUrl: null }); // Immediate response

  // Fire and forget — runs after response completes
  void generateAndPatchRecipeImage(recipe.id).catch((err) => {
    console.error(`Failed to generate image for recipe ${recipe.id}:`, err);
  });
});

async function generateAndPatchRecipeImage(recipeId: string): Promise<void> {
  const { imageUrl } = await generateRecipeImage(recipeId);
  await storage.updateRecipeImageUrl(recipeId, imageUrl);
  // Consumer can poll or use a webhook to detect image ready
}
```

## Dynamic import for env-dependent modules

When a fire-and-forget function needs to import a module that reads `process.env` at the top level, defer the import until after `loadEnv()` completes:

```typescript
// Bad: Static import evaluates at module load — env not ready
import { runware } from "../server/lib/runware"; // reads process.env.RUNWARE_API_KEY at module load

async function generateAssetImage(prompt: string): Promise<Buffer> {
  const result = await runware.generateImage(prompt);
  return result.imageBuffer;
}

// Good: Dynamic import deferred until after env is loaded
async function generateAssetImage(prompt: string): Promise<Buffer> {
  const { runware } = await import("../server/lib/runware"); // loads after env ready
  const result = await runware.generateImage(prompt);
  return result.imageBuffer;
}

// In scripts/generate-app-assets.ts
import { loadEnv } from "vite";
loadEnv("production", process.cwd());

const imageUrl = await generateAssetImage(prompt);
```

## Key elements

1. **Return immediately** from the route handler with `res.status(201).json(recipe)` — don't await the background operation
2. **Prefix with `void`** and `.catch()` to suppress the "unawaited promise" lint warning
3. **Return `null` for in-progress fields** in the response (e.g., `imageUrl: null`) so the client knows the data is pending
4. **Use `process.env` or dynamic imports** for context-dependent code — runware client, AI services, etc.
5. **Log errors explicitly** in the catch block — fire-and-forget has no caller to propagate errors to

## When to use

- Image / asset generation (recipe images, ingredient icons)
- Search index updates
- Email / notification sending
- Webhook notifications
- Analytics / metrics collection

## Exceptions

- Critical data mutations (use atomic transactions instead)
- Operations that must complete before the client proceeds
- Data that the response depends on

## Related Files

- `server/services/recipe-generation.ts` — `generateAndPatchRecipeImage`
- `server/routes/recipes.ts` — fire-and-forget trigger after response
- `scripts/generate-app-assets.ts` — dynamic import pattern

## See Also

- [Atomic operations in single request (no two-step race condition)](atomic-operations-single-request-2026-05-13.md)
- [Atomic server endpoints over multi-request client flows](atomic-server-endpoints-over-multi-request-2026-05-13.md)
