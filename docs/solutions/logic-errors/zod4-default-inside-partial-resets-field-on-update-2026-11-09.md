---
title: "zod 4 applies .default() inside .partial() — an update schema built from a create schema resets defaulted fields on every partial update"
track: bug
category: logic-errors
module: server
severity: high
tags: [zod, validation, api, data-integrity]
symptoms: ["a name-only PUT resets category to its default", "partial update overwrites a field the client never sent", "PUT with {} returns 404 instead of 400 (the at-least-one-field refine passes)"]
applies_to: ['server/routes/*.ts', 'server/routes/_*.ts', 'shared/schemas/*.ts']
created: 2026-11-09
---

## Problem

After the zod 3 → 4 upgrade, `createSchema.partial()` no longer means "every field may be absent and absent fields stay absent". A field declared `.optional().default(x)` on the create schema comes out of the partial schema as `x` when the client omits it:

```
zod 3.25: partial().parse({ name: "x" })  -> { name: "x" }
zod 4.6:  partial().parse({ name: "x" })  -> { name: "x", category: "other" }
```

Every partial update then writes the default over the stored value. Two routes were affected and caught by tests during the migration: `PUT /api/pantry/:id` (reset `category` to `"other"`) and `PUT /api/meal-plan/recipes/:id` (reset `sourceType` to `"user_created"`). The visible symptom was an existing test: `PUT` with `{}` returned 404 instead of 400, because the injected default made the "at least one field" refine pass.

## Root Cause

zod 4 runs an inner schema whose input is optional (`ZodDefault` accepts `undefined`) even when `.partial()` wraps it in `ZodOptional`, so defaults apply inside optional/partial. zod 3's `ZodOptional` short-circuited on `undefined`. (A `.transform()` on an absent key does NOT fire in zod 4 — measured — only defaults leak.)

## Solution

Unwrap the default on the update schema, keeping every other constraint from the create schema:

```ts
const updateSchema = createSchema
  .extend({ category: createSchema.shape.category.unwrap() })
  .partial();
```

Pin it with a route test that asserts the storage call receives exactly the sent fields (`expect(storage.update.mock.calls[0][2]).toEqual({ name: "x" })`) — a status-only test passes while the default is written.

To find candidates: every `.partial()` whose base schema (including spreads/extends) has a `.default(`. A quick probe — `schema.partial().safeParse({})` must return `{}` — checks drizzle-zod `insert*Schema`s in bulk (all 11 were clean on 2026-11-09).

## Related Files

- `server/routes/pantry.ts`, `server/routes/meal-plan.ts` (the fixes)
- `server/routes/__tests__/pantry.test.ts`, `server/routes/__tests__/meal-plan.test.ts` ("passes only the sent fields to storage")
