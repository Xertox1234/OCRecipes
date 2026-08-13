---
title: "A constant whose name omits its scale gets used universally — name the qualifier its siblings name"
track: knowledge
category: conventions
tags: [naming, constants, shared, nutrition, api-contract, architecture, react-native, drift]
module: shared
applies_to: ["shared/constants/**/*.ts", "server/services/**/*.ts", "client/components/nutrition/**/*.ts"]
symptoms: ["Two authors in different layers independently used a scoped constant as if it were global", "A constant sits beside siblings that name their qualifier while it does not", "A selection expression switches tables for one lookup and passes a fixed table for another", "The fix is a scale/tier/locale guard at every call site rather than one rename", "A qualifier partitions more than one value but only some of them live in the constant", "One layer is gated to the safe subset as an interim fix while another still applies the wrong one"]
created: 2026-07-31
last_updated: 2026-08-12
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
```

With both scales named, the call site's shape becomes obviously wrong when it is wrong:

```ts
const per100     = drink ? FSA_DRINK : FSA_FOOD;
const perPortion = drink ? FSA_PORTION_DRINK : FSA_PORTION_FOOD;   // symmetry restored
```

If the sibling genuinely does not exist yet, name the constant anyway and say so — an absent
`FSA_PORTION_DRINK` is a visible gap; a universal-looking `FSA_PORTION` is an invisible one.

### The rename covers the values it names, and nothing stored beside them

Shipped 2026-08-12 (PR #803). The flat two-constant shape sketched above was **not** what the
fix could use, and the reason generalises.

The FSA partitions *two* things by scale: the per-portion lines **and the portion size that
triggers them** (>100 g food, >150 ml drink). Only the lines were in the constant; the trigger
was a bare `100` hardcoded at both call sites. So renaming to `FSA_PORTION_FOOD` /
`FSA_PORTION_DRINK` restores symmetry for the lines and leaves the trigger exactly as
universal-looking as the old name was — a second instance of the same defect, one field over,
that the rename does not touch.

**When the qualifier partitions more than one value, make the container the unit of selection,
so choosing a scale chooses everything that varies with it:**

```ts
// AFTER — the trigger travels WITH its lines; you cannot select one and forget the other
export const FSA_PORTION_FOOD = {
  triggerGrams: 100,
  lines: { sugar: 27, saturatedFat: 6, sodium: 720 },
} as const;

export const FSA_PORTION_DRINK = {
  triggerGrams: 150,
  lines: { sugar: 13.5, saturatedFat: 3, sodium: 360 },
} as const;
```

Ask, before calling a rename sufficient: *what else varies with this qualifier, and is it in
here?* A hardcoded literal at the call site is the usual answer, and it is invisible to a
grep for the constant's name.

### A named sibling nothing reaches is still an invisible gap

Creating `FSA_PORTION_DRINK` did not, by itself, change a single band on screen. The client's
band layer passed no portion weight to `concernBand` at all, so the new table was dead on that
path until the panel was wired to supply one. The rename removes the wrong *reading*; it does
not establish the right *reach*. After adding the sibling, check that something selects it —
a constant with no consumer and a constant applied to the wrong scale both produce the same
user-visible output, which is nothing.

## Exceptions

- If the partition really is exhaustive at one member (a constant that provably applies to
  every case), the bare name is fine — but state *why* in the docblock, because the asymmetry
  will be questioned.
- Do not rename purely to satisfy symmetry when the constants are unrelated and merely share
  a prefix.
- **An interim "gate it to the safe subset" fix converts a shared bug into a divergence.**
  When this defect was found, `concernBand` was gated to `basis.scale === "food"` so it would
  stop applying food figures to drinks. That was right in isolation — honest under-warning
  beats a fabricated red — but the server kept applying the food table for the same release,
  so the two layers gave different verdicts on the same product. One-sided honesty is harder
  to notice than a symmetric wrong answer, because each layer looks defensible on its own.
  Ship the gate if the alternative is a false claim about someone's food; just do not treat
  the divergence window as free, and pin it with a test that judges both layers against each
  other rather than each against a hardcoded expectation.

## Related Files

- `shared/constants/nutrition-bands.ts` — `FSA_FOOD` / `FSA_DRINK` / `FSA_PORTION_FOOD` / `FSA_PORTION_DRINK`
- `server/services/universal-flags.ts` — the call site that switched one and not the other; now selects both off the same boolean
- `shared/lib/nutrition-bands.ts` — `concernBand`; the interim `basis.scale === "food"` gate is gone
- `client/components/nutrition/nutrition-band-source.ts` — supplies the portion weight that makes the drink table reachable on the client
- `todos/archive/P2-2026-07-31-fsa-portion-thresholds-are-food-only-applied-to-drinks.md` — the filed fix (PR #803)

## See Also

- [cross-the-axes-when-two-dimensions-are-covered-separately-2026-07-31.md](cross-the-axes-when-two-dimensions-are-covered-separately-2026-07-31.md) — why the test suite could not see this
- [tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md](tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md) — this very file was unreachable until 2026-08-12: its only routable tag was `api` (matched incidentally inside `api-contract`) while its `applies_to` named `shared/constants/**`, which routes to no domain at all
- [../logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md](../logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md) — another defect where a declaration's *shape* misled every reader including the compiler
- [../logic-errors/comparison-over-a-lossy-projection-reports-a-false-match-2026-08-07.md](../logic-errors/comparison-over-a-lossy-projection-reports-a-false-match-2026-08-07.md) — the sibling defect this fix also had to clear: `concernBand` compared a value whose scale it could not verify, so it now derives the portion value from per-100 instead of trusting the caller's
