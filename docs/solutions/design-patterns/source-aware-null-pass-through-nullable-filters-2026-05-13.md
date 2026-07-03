---
title: Source-aware null pass-through for nullable filter columns
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, sql, filters, null-handling, unified-queries]
applies_to: [server/storage/**/*.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# Source-aware null pass-through for nullable filter columns

## When this applies

When a filter column is nullable and the null value means `unknown` rather than `exclude`, don't compile `col IS NOT NULL AND col <= X` — that silently drops the entire null population. Instead, make the pass-through **source-aware**: pass null-valued rows through the filter when the source is one where null legitimately means "data not yet imported" (community recipes, URL imports), and exclude null-valued rows when the source is one where the user owns the data and null means "user didn't enter it" (personal recipes).

## Examples

```typescript
// ❌ Bad: drops every community recipe (they have null nutrition) from
// any macro-filtered search, including 25 seed recipes
if (maxCalories !== undefined) {
  conditions.push(sql`${recipes.caloriesPerServing} <= ${maxCalories}`);
}
```

```typescript
// ✅ Good: source-aware — community null is "unknown, show it",
// personal null is "user didn't enter it, exclude it"
function numericPassThrough(
  col: AnyPgColumn,
  value: number | undefined,
  op: "<=" | ">=",
  source: "personal" | "community",
) {
  if (value === undefined) return undefined;
  const comparison =
    op === "<=" ? sql`${col} <= ${value}` : sql`${col} >= ${value}`;
  if (source === "community") {
    // Unknown nutrition → surface the recipe; user can re-filter after import
    return or(isNull(col), comparison);
  }
  // Personal recipe: null means user left it blank; exclude from macro filters
  return comparison;
}

// Apply per-source in the query builder:
const personalConditions = [
  numericPassThrough(
    mealPlanRecipes.caloriesPerServing,
    maxCalories,
    "<=",
    "personal",
  ),
].filter(Boolean);
const communityConditions = [
  numericPassThrough(
    communityRecipes.caloriesPerServing,
    maxCalories,
    "<=",
    "community",
  ),
].filter(Boolean);
```

## When to apply

Unified queries that combine authoritative user data with externally-sourced data (community pool, catalog import, seed data). Ask for each filter: "Does the null in this column mean the user deliberately said nothing, or that we don't have the data yet?" The answer is per-source, not per-column.

**Document the semantic.** Add a comment on the column (or on `numericPassThrough` itself) saying what null means and why — the next dev adding a filter will reach for the bad pattern otherwise.

## Why

**Origin:** 2026-04-18 audit H10 — `communityToSearchable` hardcoded `caloriesPerServing/proteinPerServing/carbsPerServing/fatPerServing = null` (no schema column yet). Combined with unconditional `col <= X` filters, any `maxCalories`/`minProtein` search silently dropped the entire community pool — including the 25 seed recipes every demo user starts with.

**Resolution note (2026-04-18 M22):** The H10 bandaid (`numericPassThrough` helper in `recipe-search.ts`) was only needed because `communityRecipes` had no nutrition columns. Once those columns were added and backfilled, the pass-through was removed and community recipes are filtered on real data. **The preferred fix is always to populate the schema** — source-aware null pass-through is a temporary bridge, not a permanent architecture decision.
