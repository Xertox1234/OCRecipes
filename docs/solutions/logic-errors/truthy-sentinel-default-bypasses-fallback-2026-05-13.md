---
title: Truthy sentinel default values bypass fallback logic
track: bug
category: logic-errors
module: server
severity: medium
tags: [javascript, truthiness, default-values, sentinel, database-defaults]
symptoms: ['`||` fallback never runs because the database default value is a non-empty string', Uncategorized rows keep their sentinel value instead of being re-categorized, Existing rows with default placeholders skip re-processing logic]
applies_to: [server/services/**/*.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# Truthy sentinel default values bypass fallback logic

## Problem

Ingredients from the database had `category: "other"` (the default column value). The grocery list aggregator was supposed to re-categorize uncategorized ingredients, but the `||` fallback never ran because `"other"` is a truthy string.

## Symptoms

- A `||` fallback or default-value rewrite "doesn't do anything" on legacy or default-valued rows.
- The sentinel value shows up unchanged everywhere downstream.
- The condition looks correct ("if missing, recompute") but only triggers for `null`, `""`, or `undefined`.

## Root Cause

JavaScript's `||` operator treats every non-empty string as truthy. A column with a default like `"other"`, `"none"`, `"default"`, or `"unknown"` is truthy by JavaScript rules but semantically _means "unset"_ by the application's contract. The two definitions of "missing" diverge.

```typescript
// Bug: "other" is truthy, so categorizeIngredient() never runs
category: ing.category || categorizeIngredient(normalized);
```

## Solution

Check for the sentinel explicitly:

```typescript
// Correct: treat "other" as uncategorized
category: ing.category && ing.category !== "other"
  ? ing.category
  : categorizeIngredient(normalized);
```

Or, more robustly, centralize the "is meaningful value" predicate:

```typescript
function isCategorized(c: string | null | undefined): boolean {
  return Boolean(c) && c !== "other";
}

category: isCategorized(ing.category)
  ? ing.category
  : categorizeIngredient(normalized);
```

## Prevention

- Whenever a database column has a default _string_ value that represents "unset", document it as a sentinel and never use `||` to fall back from it.
- Prefer `null` over a string sentinel when the application semantics is "no value set". Truthiness then matches semantics.
- Code-review check: any `||` against a string field whose database default is non-empty is a smell.

## Related Files

- `server/services/grocery-generation.ts` — sentinel-aware ingredient category aggregator

## See Also

- [Longest keyword match prevents false category assignment](longest-keyword-match-categorization-2026-05-13.md) — sibling bug in the same categorisation flow
