---
title: Longest-keyword-match prevents false category assignment
track: bug
category: logic-errors
module: server
severity: medium
tags: [keyword-matching, categorization, string-search, ingredients, grocery]
symptoms: ['Compound ingredient names land in the wrong grocery category (e.g., cumin appears under meat)', First-match keyword search assigns to a generic short keyword before the specific long one is checked]
applies_to: [server/services/grocery-generation.ts, server/services/**/categori*.ts]
created: '2026-05-13'
---

# Longest-keyword-match prevents false category assignment

## Problem

Ingredient auto-categorization used first-match substring search. "Ground cumin" matched the keyword "ground" in the meat category before the loop ever reached "cumin" in spices, so cumin appeared in the meat aisle of grocery lists.

## Symptoms

- Compound ingredient names categorized by their _least specific_ keyword.
- Categorisation depends on iteration order of `Object.entries(CATEGORY_KEYWORDS)`.
- Generic single-word keywords ("ground", "cream", "white") dominate every ingredient that contains them as a substring.

## Root Cause

The original loop broke on the first keyword match. Generic short keywords are substrings of many compound ingredient names:

- "ground" (meat) matches "ground cumin", "ground cinnamon", "ground ginger"
- "cream" (dairy) matches "cream of tartar", "cream of mushroom soup"
- "white" (other) matches "white wine vinegar", "white pepper"

First-match resolves ambiguity by accident of declaration order, not by semantic specificity.

## Solution

Switch to longest-match: scan every keyword in every category, keep the longest hit.

```typescript
// Before (first-match — bug)
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  for (const kw of keywords) {
    if (lower.includes(kw)) return category; // "ground" matches first!
  }
}

// After (longest-match — correct)
let bestMatch: { category: string; length: number } | null = null;
for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
  for (const kw of keywords) {
    if (lower.includes(kw) && (!bestMatch || kw.length > bestMatch.length)) {
      bestMatch = { category, length: kw.length };
    }
  }
}
return bestMatch?.category ?? "other";
```

Additionally, prune ambiguous single-word keywords ("ground", "cream") and replace with specific compound terms ("ground beef", "ground pork", "cream cheese", "sour cream"). This is a defence-in-depth measure — longest-match alone fixes the bug, but pruning reduces false positives further.

## Prevention

- When categorizing text with keyword lists, always use longest-match to resolve ambiguity.
- Prefer specific compound terms over single words that appear in many contexts.
- Add a unit test for each category that asserts a known ambiguous ingredient ("ground cumin", "cream of tartar") lands in the _intended_ bucket.

## Related Files

- `server/services/grocery-generation.ts` — `categorizeIngredient()` function

## See Also

- [Truthy sentinel default bypasses fallback](truthy-sentinel-default-bypasses-fallback-2026-05-13.md) — same source file; complementary bug in the same categorisation flow
