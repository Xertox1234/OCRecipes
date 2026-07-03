---
title: Cross-allergy safety filter for AI/external suggestions
track: knowledge
category: conventions
module: server
tags: [security, ai-safety, allergens, food-safety, post-filter]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Cross-allergy safety filter for AI/external suggestions

## Rule

When a service returns food or ingredient recommendations from any source (AI, external API, static table), **always filter the output** against the user's declared allergens before returning results. AI exclusion prompts are insufficient as sole protection — models can and do ignore them.

## When to use

Any service that returns food/ingredient suggestions to users who have declared dietary restrictions (allergens, intolerances, dislikes). Apply as a post-filter on the combined output of all suggestion sources.

## When NOT to use

Recommendation systems without safety constraints (e.g., recipe browsing where the user hasn't declared restrictions).

## Examples

```typescript
// After collecting suggestions from all tiers (static, Spoonacular, AI):
function filterSafeSubstitutions(
  suggestions: SubstitutionSuggestion[],
  userAllergies: { name: string; severity: AllergySeverity }[],
): SubstitutionSuggestion[] {
  if (userAllergies.length === 0) return suggestions;

  return suggestions.filter((s) => {
    // Reuse the same detectAllergens() engine to check each suggestion
    const matches = detectAllergens([s.substitute], userAllergies);
    return matches.length === 0;
  });
}

// Apply to ALL tiers combined, not just one:
const allSuggestions = [...staticResults, ...spoonacularResults, ...aiResults];
const safeSuggestions = filterSafeSubstitutions(allSuggestions, userAllergies);
```

## Why

Without this filter, a tree-nut-allergic user can receive "almond flour" as a wheat substitute because: (1) static tables don't cross-reference allergens, (2) Spoonacular doesn't know about the user's allergies, and (3) AI models sometimes ignore exclusion instructions. This was caught as a critical safety bug in code review.

## Related Files

- `server/services/ingredient-substitution.ts` — `filterSafeSubstitutions()`, `buildExclusionList()`
- `shared/constants/allergens.ts` — `detectAllergens()` pure function used for both detection and filtering
