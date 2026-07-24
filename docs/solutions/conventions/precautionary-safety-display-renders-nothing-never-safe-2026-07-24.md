---
title: "Precautionary safety display renders nothing when data is absent — never a 'safe' signal"
track: knowledge
category: conventions
tags: [react-native, accessibility, safety, allergens, fail-dangerous, derived-columns, display]
module: client
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-07-24'
---

# Precautionary safety display renders nothing when data is absent — never a "safe" signal

## Rule

A **universal / precautionary** safety display (one shown to every viewer, not
personalized to their declared profile — e.g. a recipe's "Contains: <allergens>"
label) must render **nothing** when the derived safety data is absent. It must
**never** render a positive "safe" / "none" / "allergen-free" / green signal on
missing data. Absence of derived data is not a safety guarantee.

Preserve the source column's three-state distinction end-to-end and let the
component collapse it — do not collapse it upstream:

- `null` / `undefined` → **not derived yet** → render nothing (never "safe").
- `[]` → **derived, genuinely empty** → also render nothing (there is no
  positive-safe UI to show), but keep it a *distinct value in the data* so a
  future "allergens not verified" branch on `null` stays a one-line change.
- non-empty → render the precautionary label.

Concretely: type the prop as the raw `T[] | null | undefined` trichotomy, map it
through a pure function that returns `[]` for all three absent/empty forms, and
`return null` from the component on an empty result. **Never** coerce `null` into
`[]` in a DTO, a prop pass-through, or a `?? []` default on the way to the
component — that silently converts "unknown" into "verified none" and is the
fail-OPEN direction.

## Why

This is the **display-side complement** of the data/schema rule in
[Nullable, not empty, for derived safety columns](nullable-not-empty-for-derived-safety-columns-2026-05-17.md):
the column is nullable specifically so "not derived" (`null`) stays
distinguishable from "derived, empty" (`[]`). That distinction is only worth
anything if the UI honors it. If the display renders a "no allergens" / safe
badge on `null` (or on a `null`-coerced `[]`), an un-analyzed recipe — a
not-yet-backfilled import, a row added between a migration and its backfill —
reads as affirmatively safe to a user checking a recipe for an allergy. The
conservative default for a precautionary display is silence, never reassurance.

Making the "no safe branch" **structural** (there is simply no code path that
emits a positive signal) is stronger than a conditional that could be inverted
later: a reviewer can confirm safety by grepping for the absence of any
"safe"/"none"/"allergen-free" string, not by reasoning about branch conditions.

## Examples

```typescript
// GOOD — pure util collapses all absent/empty forms to [], no synthesized "safe"
export function toRecipeAllergenLabels(
  allergens: DerivedRecipeAllergen[] | null | undefined,
): { id: AllergenId; label: string }[] {
  if (!allergens || allergens.length === 0) return []; // null | undefined | []
  return allergens.map(({ id }) => ({ id, label: ALLERGEN_INGREDIENT_MAP[id].label }));
}

// GOOD — component has NO positive-safe branch; empty => renders nothing
export const RecipeAllergenLabel = React.memo(function RecipeAllergenLabel({
  allergens,
}: { allergens: DerivedRecipeAllergen[] | null | undefined }) {
  const labels = toRecipeAllergenLabels(allergens);
  if (labels.length === 0) return null; // never an "allergen-free" chip
  // ...render "Contains: <labels>"
});

// BAD — coercion upstream destroys the null/[] distinction (fail-OPEN)
<RecipeAllergenLabel allergens={recipe.allergens ?? []} />   // null now reads as "verified none"

// BAD — a positive-safe branch on absent data
if (!allergens?.length) return <SafeBadge label="No known allergens" />; // reassures on unknown
```

## Exceptions

- A **personalized** safety surface (matched against the *viewer's* declared
  profile, e.g. `AllergenWarningBanner`) is a different contract — it may legitimately
  render nothing for a viewer with no matching allergy and is allowed its own
  "check failed, tap to retry" cautionary state. This rule is about the
  *universal/precautionary* baseline shown to everyone.
- Rendering an explicit **"allergens not verified"** string on `null` is
  permitted (and may be preferable when the real-world `null` rate is high) — it
  is not a "safe" signal. What is forbidden is any affirmative safe/none/empty
  reassurance on absent data. Rendering nothing is the compliant default.

## Related Files

- `client/components/recipe-allergen-label-utils.ts` — `toRecipeAllergenLabels` collapses the trichotomy without synthesizing a safe value
- `client/components/RecipeAllergenLabel.tsx` — component with no positive-safe branch
- `shared/constants/allergens.ts` — `DerivedRecipeAllergen`, `isRecipeSafeForAllergies` (fail-closed on `null` on the query side)

## See Also

- [Nullable, not empty, for derived safety columns](nullable-not-empty-for-derived-safety-columns-2026-05-17.md) — the data/schema-side rule this display rule complements
- [Parent label prefix for decorative children](parent-label-prefix-decorative-children-2026-05-13.md) — the a11y composition pattern such a reused label needs when nested in an accessible parent
