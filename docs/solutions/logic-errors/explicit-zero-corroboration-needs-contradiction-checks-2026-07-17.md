---

title: "Explicit-zero corroboration must not inherit the nonzero path's guards and must cross-check the record's own redundant fields"
track: bug
category: logic-errors
tags: [nutrition, barcode, data-trust, sentinel-values, self-consistency, zero-handling]
module: server
applies_to: ["server/services/**/*.ts"]
symptoms: ["Zero-calorie product cached with phantom calories despite the explicit-zero shield shipping", "Unfilled OFF stub (placeholder-zero energy, real macros) locked in at 0 kcal — secondary rescue never fires", "Fix passes its test but fails in prod for the same product class — test input matched the one format the inherited guard accepts"]
created: 2026-07-17
severity: high

---

# Explicit-zero corroboration must not inherit the nonzero path's guards and must cross-check the record's own redundant fields

## Problem

PR #656 taught the `offSelfConsistent` gate that BOTH energy fields explicitly
`0` is corroboration (water must stay 0 kcal), by adding an early-return inside
the existing gate. Review found the branch was wrong in both directions at once:

- **Too narrow:** the zero branch sat BELOW the `offLabelGrams` parseability
  guard, inherited from the ratio check. Grams are irrelevant to zero-agreement
  (`0 × grams / 100 = 0` for any grams), so every zero-cal product with a
  non-metric serving label ("1 bottle", "8 fl oz", absent) silently kept the
  phantom-calorie bug the PR existed to fix.
- **Too wide:** the branch trusted the two zeros without asking whether the
  rest of the record contradicts them. OFF data-entry stubs save explicit `0`
  (not blank) for untouched energy fields while carrying real macros; kcal
  fields can be `0` beside real kJ fields (`energy_100g`), and the explicit `0`
  wins the `??` fallback because 0 is not nullish. Both shapes became
  "self-consistent", disabling the CNF/USDA rescue and caching impossible rows
  (0 kcal / 33 g fat) first-write-wins into the monetized table.

## Symptoms

- A shipped explicit-zero fix that passes its regression test yet the same
  product class keeps failing in prod (different serving-size format)
- Rows in `barcode_nutrition` where calories = 0 but macros imply hundreds of
  kcal (Atwater), or kcal fields are 0 while kJ fields are large

## Root Cause

A sentinel-acceptance branch (explicit 0 = trustworthy) was bolted into a gate
built for a different test (three nonzero fields agreeing within tolerance).
The new branch inherited preconditions only the old path needs, and skipped the
validation instinct the old path got for free — three mutually-constraining
nonzero values can't agree by accident, but `0 === 0` carries no information
about the rest of the record.

## Solution

Structure the gate as: presence guards → zero-corroboration branch → general
branch, where the zero branch has its OWN preconditions:

```ts
if (offPerServingCal === undefined || offPer100g.calories === undefined) return false;
if (offPerServingCal === 0 && offPer100g.calories === 0) {
  const macroKcalPer100g = 4 * (p ?? 0) + 4 * (c ?? 0) + 9 * (f ?? 0); // Atwater
  // Round kJ→kcal the SAME way the calories derivation does — a trace kJ
  // residual (2 kJ ≈ 0.48 kcal) rounds to 0 there and must not contradict here
  const kjContradicts =
    Math.round((nm.energy_100g ?? 0) / 4.1868) > 0 ||
    Math.round((nm.energy_serving ?? 0) / 4.1868) > 0;
  return macroKcalPer100g <= ZERO_CAL_MAX_MACRO_KCAL_100G && !kjContradicts;
}
// grams guard + >0 guards + 15% ratio check — the nonzero path only
```

`ZERO_CAL_MAX_MACRO_KCAL_100G = 4` is a per-100g heuristic loosely inspired by
(not equivalent to) the US "<5 kcal per serving rounds to zero" labeling rule —
water/diet soda/black coffee pass, stubs don't. A contradiction check on a
redundant encoding must apply the SAME normalization (rounding, unit
conversion) the trusted value was derived with, or trace values self-contradict
(review round 2 caught exactly this in the first version of the kJ check).

## Prevention

- When special-casing a sentinel value (0, "", empty array) as *present and
  trustworthy*, write down which existing guards the special case actually
  needs — inheriting the general path's guards is how the case silently
  un-fixes itself for inputs that differ from the motivating repro.
- Ask what OTHER fields in the same record can contradict the sentinel
  (redundant encodings: kcal vs kJ, energy vs Atwater-from-macros) and check
  them — agreement between two defaulted zeros is not evidence.
- Test the special case with inputs that DIFFER from the prod repro along each
  guard dimension: the PR's original test used serving `"500g"` — the one
  format the inherited grams guard accepts — so the too-narrow failure was
  invisible until review. (TDD red runs for all three review fixes confirmed
  each was a live defect: 51 phantom kcal, and two wrongly-kept zeros.)

## Related Files

- `server/services/barcode-lookup.ts` — `offSelfConsistent` gate, `ZERO_CAL_MAX_MACRO_KCAL_100G`
- `server/services/__tests__/barcode-lookup.test.ts` — "(PR #656 review)" tests: unparseable-serving shield, macro contradiction, kJ contradiction

## See Also

- [name-matched-secondary-must-not-replace-self-consistent-label](name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md) — the gate this branch extends, and why poisoned cache rows need manual delete/re-seed
- [trust-flag-conflated-with-secondary-source-agreement](trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md) — sibling trust-signal conflation in the same pipeline
