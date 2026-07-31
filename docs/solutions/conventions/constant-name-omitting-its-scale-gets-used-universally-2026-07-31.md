---
title: "A constant whose name omits its scale gets used universally — name the qualifier its siblings name"
track: knowledge
category: conventions
tags: [naming, constants, shared, nutrition, api-contract, drift]
module: shared
applies_to: ["shared/constants/**/*.ts"]
symptoms: ["Two authors in different layers independently used a scoped constant as if it were global", "A constant sits beside siblings that name their qualifier while it does not", "A selection expression switches tables for one lookup and passes a fixed table for another", "The fix is a scale/tier/locale guard at every call site rather than one rename"]
created: 2026-07-31
---

# A constant whose name omits its scale gets used universally

## Rule

When a set of constants is partitioned by some qualifier — scale, tier, locale, platform — and
some members name that qualifier, **every** member must. A sibling whose name omits it reads as
"applies to all of them", and will be used that way.

```ts
export const FSA_FOOD    = { … };   // names its scale
export const FSA_DRINK   = { … };   // names its scale
export const FSA_PORTION = { … };   // ← reads as scale-agnostic. It is not: it is FOOD-only.
```

## Smell patterns

- Two or three constants share a prefix; some carry a qualifier suffix and one does not.
- A call site that correctly switches on the qualifier for one constant passes another
  unconditionally, in the same expression:

  ```ts
  const per100 = drink ? FSA_DRINK : FSA_FOOD;              // switched ✅
  nutrientFlag("sugar", s.sugar, sv?.sugar, per100.sugar.high, FSA_PORTION.sugar);  // not ✅
  ```

- The docblock says "food scale only" but the identifier does not.
- Independent reviewers ask "does this apply to drinks too?" about the same symbol.

## Why

The identifier is what people read at the call site; the docblock is what they read once, if
ever. When `FSA_FOOD` and `FSA_DRINK` sit next to `FSA_PORTION`, the asymmetry is a positive
signal that the third one spans both — it is the only reading under which the naming is
consistent.

This is not theoretical. In this repo the same defect was written **twice, independently, in
different layers, months apart**:

- `server/services/universal-flags.ts` — switches the per-100 table on `drink`, then passes
  `FSA_PORTION.*` unconditionally
- `shared/lib/nutrition-bands.ts` `concernBand` — applied the same food table to drinks until
  a review caught it

Neither author copied the other. Both read a name that promised universality. The FSA in fact
publishes a **separate drink portion table** at roughly half the values, with a different
trigger size (>150 ml rather than >100 g) — so the effect is a ~2× under-warning on drinks.

A rename is a cheaper and more durable fix than a guard at each call site, because it removes
the wrong reading rather than defending against it. Guards must be added at every future call
site; a name is enforced by every future reader.

## Examples

```ts
// BEFORE
export const FSA_PORTION = { sugar: 27, saturatedFat: 6, sodium: 720 };

// AFTER — the name now carries what the docblock was carrying alone
export const FSA_PORTION_FOOD  = { sugar: 27,   saturatedFat: 6, sodium: 720 };
export const FSA_PORTION_DRINK = { sugar: 13.5, saturatedFat: 3, sodium: 360 };
```

With both named, the call site's shape becomes obviously wrong when it is wrong:

```ts
const per100   = drink ? FSA_DRINK : FSA_FOOD;
const perPortion = drink ? FSA_PORTION_DRINK : FSA_PORTION_FOOD;   // symmetry restored
```

If the sibling genuinely does not exist yet, name the constant anyway and say so — an absent
`FSA_PORTION_DRINK` is a visible gap; a universal-looking `FSA_PORTION` is an invisible one.

## Exceptions

- If the partition really is exhaustive at one member (a constant that provably applies to
  every case), the bare name is fine — but state *why* in the docblock, because the asymmetry
  will be questioned.
- Do not rename purely to satisfy symmetry when the constants are unrelated and merely share
  a prefix.

## Related Files

- `shared/constants/nutrition-bands.ts` — `FSA_FOOD` / `FSA_DRINK` / `FSA_PORTION`
- `server/services/universal-flags.ts` — the call site that switches one and not the other
- `shared/lib/nutrition-bands.ts` — `concernBand`, gated to `basis.scale === "food"` as an interim fix
- `todos/P2-2026-07-31-fsa-portion-thresholds-are-food-only-applied-to-drinks.md` — the filed fix, which includes the rename

## See Also

- [cross-the-axes-when-two-dimensions-are-covered-separately-2026-07-31.md](cross-the-axes-when-two-dimensions-are-covered-separately-2026-07-31.md) — why the test suite could not see this
- [../logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md](../logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md) — another defect where a declaration's *shape* misled every reader including the compiler
