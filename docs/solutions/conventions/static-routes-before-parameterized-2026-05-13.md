---
title: "Register static routes before parameterized routes that share a prefix"
track: knowledge
category: conventions
tags: [api, express, routing, ordering]
module: server
applies_to: ["server/routes/**/*.ts", "server/routes.ts"]
created: 2026-05-13
---

# Register static routes before parameterized routes that share a prefix

## Rule

In Express, register static path routes BEFORE parameterized routes that share the same prefix. Otherwise the static path matches as a parameter value.

## Why

Express matches routes in registration order. `/:barcode` matches any string — including `user-count`. Add a comment documenting the ordering requirement to prevent future reordering.

## Examples

```typescript
// CORRECT order: static first, then parameterized
app.get("/api/verification/user-count", requireAuth, handler); // ← static
app.get("/api/verification/:barcode", requireAuth, handler); // ← parameterized

// WRONG order: "user-count" matches as barcode param
app.get("/api/verification/:barcode", requireAuth, handler); // ← matches first
app.get("/api/verification/user-count", requireAuth, handler); // ← never reached
```

## Cross-file ordering

When splitting a route file into multiple modules (e.g., `recipes.ts` + `recipe-search.ts` + `recipe-catalog.ts`), the same rule applies at the `server/routes.ts` registration level. If one file owns `/api/recipes/:id` and another owns `/api/recipes/search`, the search module **must be registered first** in `routes.ts`, otherwise the `:id` handler will greedily match `"search"` and return a 400 "invalid id" before the search handler is reached.

```typescript
// server/routes.ts
// Register recipe-search BEFORE recipes — /api/recipes/search and /browse
// must match before /api/recipes/:id, otherwise Express tries to parse
// "search"/"browse" as an int id.
registerRecipeSearch(app);
registerRecipes(app);
```

Route-splitting tests must mirror the production registration order — if the test's `createApp()` helper registers modules in the wrong order, all the affected endpoint tests return 400 instead of 200 and the cause is non-obvious. Add a comment in both `routes.ts` and the test file.

## Related Files

- `server/routes/verification.ts` — `user-count` registered before `/:barcode`
- `server/routes.ts` — `registerRecipeSearch` before `registerRecipes`
- `server/routes/__tests__/recipes.test.ts` — mirrors production registration order
