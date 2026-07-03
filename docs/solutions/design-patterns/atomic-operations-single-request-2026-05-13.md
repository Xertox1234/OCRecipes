---
title: Atomic operations in single request (no two-step race condition)
track: knowledge
category: design-patterns
module: server
tags: [api, atomicity, transactions, race-conditions, routes]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# Atomic operations in single request (no two-step race condition)

## When this applies

When an operation involves multiple related state changes (e.g., "generate and share a recipe"), avoid a two-step client flow (generate → then share) that leaves a race window where the resource exists but hasn't been shared yet. Instead, accept a flag in the first request and handle both atomically on the server.

## Why

Two-step flows create a race condition window where:

- The first request succeeds but the second fails (network error, server crash, etc.)
- The resource is partially updated
- The client retry logic may hit race conditions if not carefully designed

Atomic operations ensure: "Either the entire operation succeeds with all flags set correctly, or nothing happens." No partial states.

## Examples

```typescript
// Bad: Two-step client flow leaves race condition
// Step 1: Client generates recipe
POST /api/recipes { title: "...", shareToPublic: ??? }
→ res: { id: "r123", isPublic: false }

// Step 2: Client shares recipe (separate request)
POST /api/recipes/r123/share { isPublic: true }
→ Window: recipe exists but is private; if server crashes between steps, recipe is stuck private

// Good: Atomic flag in single request
POST /api/recipes { title: "...", shareToPublic: true }
→ Server sets isPublic atomically inside the transaction
→ res: { id: "r123", isPublic: true }
```

Implementation:

```typescript
// shared/schemas/recipe.ts
export const recipeGenerationSchema = z.object({
  title: z.string().max(200),
  servings: z.number().int().positive().optional(),
  shareToPublic: z.boolean().optional(), // Add atomic flag
  // ... other fields
});

// server/routes/recipes.ts
app.post("/api/recipes", requireAuth, async (req, res) => {
  const { title, servings, shareToPublic } = req.body;

  // Validate and create atomically
  const recipe = await db.transaction(async (tx) => {
    const newRecipe = await tx
      .insert(recipes)
      .values({
        userId: req.userId,
        title,
        servings,
        isPublic: shareToPublic ?? false, // Set atomically
        createdAt: new Date(),
      })
      .returning();
    return newRecipe[0];
  });

  res.status(201).json(recipe);
});

// client/components/RecipeGenerationModal.tsx
const handleGenerate = async () => {
  const response = await fetch("/api/recipes", {
    method: "POST",
    body: JSON.stringify({
      title: "...",
      shareToPublic: shouldShare, // Single request
    }),
  });
  const recipe = await response.json();
  // No second share step needed
};
```

## Key elements

1. **Add the state flag to the schema** (e.g., `shareToPublic: z.boolean().optional()`)
2. **Handle atomically on the server** inside a transaction (set `isPublic` based on the flag)
3. **Remove the second client-side request** that updates the state after creation
4. **Return the full result** so client sees the correct final state immediately

## When to use

- Generate + share (recipe, meal plan)
- Create + enable (feature, subscription)
- Upload + process (image, document)
- Any operation where multiple related fields should be set together

## Exceptions

- Independent sequential operations (no causal link)
- Operations where the client needs to decide step 2 based on step 1's result

## Related Files

- `shared/schemas/recipe.ts` — `recipeGenerationSchema` with `shareToPublic`
- `server/routes/recipes.ts` — atomic recipe creation

## Origin

Audit finding M1 (2026-04-26).

## See Also

- [Atomic server endpoints over multi-request client flows](atomic-server-endpoints-over-multi-request-2026-05-13.md)
- [Fire-and-forget background operations after response](fire-and-forget-background-operations-2026-05-13.md)
