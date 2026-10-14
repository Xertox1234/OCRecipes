---
title: An allergen filter over AI free text must use the canonical matcher and blank every non-letter — a bare id match never fires for tree_nuts/milk/wheat, and punctuation hides the rest
track: bug
category: logic-errors
module: server
severity: high
tags: [ai-prompting, security, allergens, nutrition, safety, string-matching, testing]
symptoms: [A card naming "Almond Walnut Pesto" survives a tree_nuts allergy, "Four-Cheese Bake" survives a milk allergy and "Garlic Bread" survives a wheat allergy, "…topped with crunchy peanuts." survives a peanut allergy (allergen is the last word before a period), "Thai Satay—Peanut Noodles" survives a peanut allergy (unspaced em dash), The only test row uses peanuts so the suite stays green]
applies_to: [server/services/inspired-recipes/suggest-listing.ts, server/services/**/*.ts, shared/constants/allergens.ts]
created: '2026-10-13'
---

# An allergen filter over AI free text must use the canonical matcher and blank every non-letter

## Problem

The inspired-recipes safety net (`dropAllergenConflicts`) drops any AI-written idea card whose title, description or tags conflict with the user's allergies. It failed three times before it worked, and the reviews caught all three:

1. **It substring-matched the stored allergy name.** Allergies are stored as canonical **ids** (`peanuts`, `tree_nuts`, `milk`, `eggs`, `wheat`, `soy`, `fish`, `shellfish`, `sesame`). `tree_nuts` can never appear in prose. `milk` never matches "cheese", "cream" or "butter", and `wheat` never matches "pasta", "bread" or "flour". Only the ids that are also English words (peanut, egg, fish) ever fired.
2. **It then used the canonical matcher (`detectAllergens`) on raw text.** The matcher's word boundary is `[\s,;/()\-]`, which has no `.`. "…topped with crunchy peanuts." does not match, and a one-sentence description almost always ends with a period.
3. **It then blanked a hand-picked punctuation list (`.!?:"'’“”`).** That still missed an unspaced em or en dash, `&`, `+`, `_` and `…`. The final review measured "Thai Satay—Peanut Noodles" with a peanut allergy: the card survived.

## Symptoms

See frontmatter. Every version passed its own tests, because the only allergen row was `peanuts`: the one id whose name is also a word, tested in a phrase with spaces around it.

## Root Cause

- **Two vocabularies.** The profile stores allergen ids. Card text uses ingredient words. Only `ALLERGEN_INGREDIENT_MAP` (via `detectAllergens` / `normalizeAllergenId` in `shared/constants/allergens.ts`) maps one to the other.
- **The matcher was built for ingredient names, not prose.** Ingredient strings rarely carry sentence punctuation or dashes, so its boundary class never needed them. AI-written prose always does.

## Solution

```ts
// server/services/inspired-recipes/suggest-listing.ts
const fields = [d.title, d.description, ...d.tags].map((f) =>
  // The shared matcher's word boundaries are [\s,;/()\-]: blank every
  // non-letter/digit run so "peanuts." and "Satay—Peanut" still match.
  f.replace(/[^\p{L}\p{N}]+/gu, " "),
);
if (mapped.length > 0 && detectAllergens(fields, mapped).length > 0) return false;
```

- Normalise each allergy name with `normalizeAllergenId`, and force every severity to `"severe"` so derived keywords always apply. A mild allergy must not slip through the direct-keyword-only tier.
- Keep a literal-name fallback only for names that can't be mapped. Filter out blank names: a name that normalises to `""` matches everything.
- Blanking every non-alphanumeric is a superset of any hand list. It can over-flag, which is the safe direction for a safety filter.

## Prevention

- When you test an allergen filter, include an id that is **not** an English word (`tree_nuts`), and a non-obvious ingredient for `milk` (cheese) and for `wheat` (bread).
- Put the allergen at the end of a sentence, and next to an unspaced dash.
- Generate the separator cases rather than hand-listing them. The reviewer that found gap 3 built rows from 22 separators.
- The AI prompt is the first defence: use `allergenDetail: "extended"` so the model sees the ingredient examples. The filter is the backstop and must not depend on the model.

## Related Files

- `server/services/inspired-recipes/suggest-listing.ts` — `dropAllergenConflicts`
- `shared/constants/allergens.ts` — `detectAllergens`, `normalizeAllergenId`, boundary regex (~:674)
- `server/services/inspired-recipes/__tests__/suggest-listing.test.ts`

## See Also

- [allergen-keyword-matcher-singular-only-plural-under-detection](allergen-keyword-matcher-singular-only-plural-under-detection-2026-07-21.md) — the matcher's own plural gap
- [allergen-keyword-matcher-plant-substitute-false-positive](allergen-keyword-matcher-plant-substitute-false-positive-2026-05-20.md) — why "almond milk" doesn't flag milk
- [cross-allergy-ai-safety-filter-defense-in-depth](cross-allergy-ai-safety-filter-defense-in-depth-2026-05-13.md) — prompt + post-filter layering
