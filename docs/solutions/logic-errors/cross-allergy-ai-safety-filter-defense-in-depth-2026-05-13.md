---
title: AI ingredient substitution suggested user's own allergens
track: bug
category: logic-errors
module: server
severity: critical
tags: [allergens, ai-safety, substitution, security, jsonb, zod]
symptoms: [Substitution service suggests almond flour to a tree-nut-allergic user, Allergen warning shows 'milk' for unrelated suggestions, Allergies JSONB cast crashes on null or malformed entries]
applies_to: [server/services/ingredient-substitution.ts, server/routes/allergen-check.ts]
created: '2026-03-18'
---

# AI ingredient substitution suggested user's own allergens

## Problem

The intelligent allergen substitution feature combined three suggestion tiers (static table, Spoonacular API, AI). All three operated independently without cross-referencing the user's allergy list — AI exclusion prompts ("do NOT suggest nuts") were not consistently honored, and the static and API tiers had no allergen guard at all. Two related bugs surfaced in the same review: a `?? "milk"` fallback that fabricated allergen attribution, and an unsafe `as` cast on the JSONB `allergies` column.

## Symptoms

- Almond flour suggested as a wheat substitute to a tree-nut-allergic user
- Allergen warnings show "milk" on suggestions unrelated to dairy
- Server crash with cryptic error when `profile.allergies` is `null` or contains an unexpected element shape

## Root Cause

1. **No cross-allergy gate on combined output.** Each suggestion tier produced its own list. The AI's exclusion prompt was defense-in-depth, not a hard gate; static and API tiers had no gate at all.
2. **Domain-meaningful fallback fabricates data.** `match?.allergenId ?? "milk"` invented a "milk" attribution whenever a Map lookup missed.
3. **Unsafe `as` cast on JSONB.** `profile.allergies as { name: string; severity: string }[]` provided zero runtime protection. `null`, a bare string, or an object missing fields would crash downstream code.

## Solution

1. **Add a final cross-allergy filter on combined output:**

```typescript
const safe = filterSafeSubstitutions(allSuggestions, userAllergies);
// internally: detectAllergens(suggestion) ∩ userAllergies must be empty
```

Also build an `buildExclusionList()` for the AI prompt as the first line of defense.

2. **Skip on lookup miss, never fabricate:**

```typescript
// Bad
allergenId: match?.allergenId ?? "milk";

// Good
const match = allergenMap.get(name);
if (!match) continue; // skip unresolvable entries
allergenId: match.allergenId;
```

3. **Per-element Zod validation:**

```typescript
function parseAllergies(raw: unknown): Allergy[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => allergySchema.safeParse(entry))
    .filter((r) => r.success)
    .map((r) => r.data);
}
```

## Prevention

- AI exclusion prompts are defense-in-depth, not a safety gate. Always validate AI output programmatically.
- Never use a domain-meaningful value as a `??` fallback. Skip or log; do not fabricate.
- When a Zod schema exists for a JSONB element, parse per-element with `safeParse()` so partial corruption doesn't blow up the whole list.
- Multi-tier pipelines must apply the safety filter to combined output, not per-tier — each tier has different blind spots.
- Safety-critical filter functions need dedicated unit tests. `filterSafeSubstitutions` and `buildExclusionList` initially had none; review forced them.

## Related Files

- `server/services/ingredient-substitution.ts`
- `server/routes/allergen-check.ts`
- `shared/constants/allergens.ts`

## See Also

- [Cross-allergy safety filter for AI/external suggestions](../conventions/cross-allergy-safety-filter-ai-external-suggestions-2026-05-13.md)
- [Zod safeParse per JSONB element](../conventions/zod-safeparse-per-jsonb-element-2026-05-13.md)
