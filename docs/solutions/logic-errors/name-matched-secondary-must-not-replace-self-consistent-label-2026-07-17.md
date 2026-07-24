---
title: A similarity-matched secondary source must never replace identity-matched, self-consistent label data
track: bug
category: logic-errors
tags: [nutrition, barcode, data-provenance, cross-validation, openfoodfacts, cnf]
module: server
applies_to: [server/services/**/*.ts]
symptoms: [Displayed calories wildly off (e.g. 98 shown for a package stating 310 per 90g) while the serving size is correct, The wrong value scales exactly as per100g x servingGrams/100 from a calorie density belonging to a DIFFERENT generic food, lookupBarcode result source is "cnf"/"usda" for a product whose barcode was found in OFF with complete nutriments]
created: '2026-07-17'
last_updated: '2026-07-24'
severity: high
---

# A similarity-matched secondary source must never replace identity-matched, self-consistent label data

## Problem

`server/services/barcode-lookup.ts`'s `lookupBarcode` cross-validates Open Food
Facts per-100g calories against a CNF/USDA secondary and, when they disagreed
by more than 2× (`reconcilePer100g`, `preferSecondaryOnDiscrepancy: true` for
OFF primaries), **replaced** OFF's value with the secondary's. Live failure
(McSweeney's Pepperoni & Cheddar Cheese Sticks, barcode `0778918011332`): OFF
had the package exactly right and internally consistent — 344.4 kcal/100g,
`energy-kcal_serving` 310, `serving_size` "90 g" (344.4 × 0.9 = 310 ✓, matching
the physical panel to the digit). The CNF secondary was found by fuzzy
**name-searching** the OFF category term "cheese snack" and matched a generic
at ~109 kcal/100g — a different food entirely. Ratio 344/109 = 3.16 > 2 →
"disagree" → OFF's correct density replaced with the generic's, then scaled by
OFF's own 90 g serving label: the app displayed **98 kcal for a 310-kcal
serving**, with the serving size looking perfectly "adopted."

## Symptoms

- Calories far off the package while serving size is right — the displayed
  number back-computes to a per-100g density that belongs to a different food
- `source` on the lookup result is the secondary ("cnf"/"usda") even though the
  barcode resolved in OFF with full nutriments
- The error factor is stable across rescans (recomputed live, not a cache fluke)

## Root Cause

The reconciliation policy treated two sources of **different provenance rank as
peers**. A barcode lookup is an *identity* match — the data claims to describe
this exact product. A name/category search is a *similarity* match — it returns
the nearest generic, which can be a different preparation (cooked vs dry) or a
different food altogether. The policy's premise ("community-edited OFF is the
suspect party") inverts precisely when OFF's entry is transcribed from the real
package — and OFF tells you when that is likely: an entry whose per-serving,
per-100g, and serving-size fields corroborate each other (three independently
entered values agreeing) is near-certainly label-derived. The code never read
`energy-kcal_serving` at all, so this self-consistency signal was invisible to
the decision.

## Solution

Compute an `offSelfConsistent` signal at extraction time and demote the
secondary from "replace on discrepancy" to "gap-fill only" when it holds
(`server/services/barcode-lookup.ts`):

```typescript
const offPerServingCal =
  nm["energy-kcal_serving"] ??
  (nm.energy_serving !== undefined
    ? Math.round(nm.energy_serving / 4.1868) // kJ fallback, same constant as the _100g path
    : undefined);
const offLabelGrams = parseServingGrams(offProduct?.serving_size || "");
const offSelfConsistent =
  offPerServingCal !== undefined && offPerServingCal > 0 &&
  offLabelGrams !== null && offLabelGrams > 0 &&
  offPer100g.calories !== undefined && offPer100g.calories > 0 &&
  Math.abs((offPer100g.calories * offLabelGrams) / 100 - offPerServingCal) /
    offPerServingCal <= 0.15; // label-rounding tolerance

// later, in the OFF-primary branch:
reconcilePer100g(offPer100g, secondaryPer100g, secondarySource,
  "openfoodfacts", /* preferSecondaryOnDiscrepancy */ !offSelfConsistent, code);
```

Entries missing per-serving energy (most of OFF) keep the old
replace-on-discrepancy behavior — the swap still rescues genuinely wrong OFF
entries (the "sugar at 50 kcal/100g vs CNF 387" case), and an internally
contradictory entry (per-serving disagreeing with per-100g × grams) is not
shielded. Both are pinned by guard tests, along with just-under/just-over
15%-boundary fixtures.

## Prevention

- Rank provenance before reconciling: identity-matched data that corroborates
  itself > identity-matched data > similarity-matched data. A similarity match
  may **gap-fill** missing fields of an identity match; it must never
  **replace** them unless the identity-matched data fails its own internal
  consistency check.
- When a source provides redundant fields (per-100g, per-serving, serving
  size), read all of them — agreement between independently entered fields is a
  trust signal; code that extracts only one basis throws that signal away.
- Known accepted trade-off: an entry whose three fields are jointly wrong yet
  consistent (panel pasted from a sibling SKU) is now shielded from the
  cross-check.
- The `barcodeNutrition` cache is first-write-wins: rows poisoned by the old
  policy do NOT self-heal after the fix deploys — remediation is a manual
  delete/re-seed per affected barcode. A follow-up sweep + delete/re-seed for
  rows poisoned before this fix shipped remains a **manual, human-executed**
  step — never run it autonomously (see `## Refinements shipped` below for
  why an autonomous agent specifically could not complete it).

## Refinements shipped (2026-07-17, todo P3-2026-07-17-off-self-consistency-gate-refinements)

Both deferred refinements from the original fix were implemented:

- **Provenance marker**: `reconcilePer100g` now emits
  `"<primaryLabel>+self-consistent"` (not plain `"<primaryLabel>"`) in the
  narrow case where a secondary was found, both calorie values were positive,
  they disagreed, and the disagreement was rejected specifically because
  `preferSecondaryOnDiscrepancy` was false. Consumer audit before shipping:
  `client/hooks/useNutritionLookup.ts` never reads `.source` from the barcode
  response at all; `server/routes/public-api.ts`'s `serializeFreeResponse`
  forwards `row.source` verbatim with no matching (`FreeProductResponse.source`
  is an unconstrained `z.string()`). No consumer does exact/substring matching
  on `"openfoodfacts"` — safe to extend.
- **Low-calorie absolute floor**: a 5 kcal absolute floor, OR'd alongside the
  15% relative check, rescues low-calorie labels (spices, condiments) from
  FDA/Codex nearest-5-kcal rounding noise that can exceed 15% relative
  deviation even for a genuinely correct label.
- **Numeric-agreement consolidation**: the gate's relative check now calls
  `valuesMatch(scaledPer100g, offPerServingCal, 0.15)` from
  `server/lib/verification-consensus.ts` instead of inline math, adding an
  optional `tolerance` param (default `0.05`, preserving existing callers) to
  that shared primitive.

**Reusable gotcha surfaced by this refinement**: consolidating a
hand-written relative-tolerance check onto a shared primitive is not
automatically behavior-preserving even when the tolerance value itself is
passed through unchanged. This gate's original inline check divided by
`offPerServingCal` (a specific, fixed reference operand — the label value);
`valuesMatch`'s relative branch divides by `max(|a|, |b|)` (symmetric,
whichever operand is larger). When the two candidate values differ, these
denominators diverge, silently shifting the exact tolerance boundary (here,
≈269.6 → ≈263.5 for one fixture — a real, if small and fail-safe, widening).
**Before adopting a shared tolerance/agreement primitive for an
existing check, work out whether its denominator convention matches the
one being replaced — and if you have boundary-pinning regression tests
(this file's just-under/just-over fixtures), expect them to catch the
drift; retune them to the new boundary rather than treat a suddenly-failing
pin as a false positive.**

A related, still-**deferred-to-a-human** item: the original fix's `## Prevention`
called for a prod cache sweep + delete/re-seed of rows poisoned before this
fix shipped. That could not be completed autonomously in the follow-up todo
— not by choice, but because the session's own auto-mode permission
classifier explicitly blocked every attempt to read production database
credentials or run even a read-only query against prod (`railway variables`,
`railway run -- psql ...`), independent of any judgment call made by the
agent. The exact sweep query and remediation commands are documented in
`todos/archive/P3-2026-07-17-off-self-consistency-gate-refinements.md`'s
Updates section for whoever picks this up.

## Widened 2026-07-24 (todo P2-2026-07-22): the gate's trigger was too narrow

The 2026-07-17 fix made the gate depend on **per-serving energy**, and the
original write-up accepted that "entries missing per-serving energy (most of
OFF) keep the existing replace-on-discrepancy behavior." That residual was the
bug's next incarnation.

Live case: `3017620422003` (Nutella 750 g). OFF has the per-100g block exactly
right — 539 kcal, 56.3 g sugar, 30.9 g fat, 10.6 g sat-fat — but carries **no
`serving_size` and no `energy-kcal_serving`**. The gate could not run, so a CNF
name match at 182 kcal (539/182 ≈ 2.96×) replaced the whole block. Users saw a
different food's macros, and the FSA nutrient flags added in PR #694 emitted no
`nutrient:sugar` because they correctly evaluated the wrong `sugar: 3.1`.

The tell that this was a gate hole and not bad OFF data: the **400 g sibling
SKU** (`3017620425035`) has identical macros *plus* a serving size, and was
always correct. Trust depended on which jar you scanned.

**Fix**: a second corroboration path, `offMacrosCohereWithEnergy` — Atwater
macro↔energy coherence (4·protein + 4·carbs + 9·fat ≈ `energy-kcal_100g`) on the
per-100g block alone.

### Precedence is fallback, NOT a boolean OR

The obvious implementation — OR the new term into the existing expression — is
wrong twice over:

1. The existing IIFE returns `false` on its **first line** when per-serving
   energy is absent, which is exactly the broken case. An OR'd term
   short-circuits and silently does nothing.
2. More importantly, a **detected contradiction must outrank a passed coherence
   check**. An OFF "Sugar" entry at 50 kcal/100g with 12 g carbs is coherent on
   the per-100g basis alone (Atwater 48 ≈ 50) yet its own per-serving field
   proves it garbage. An OR shields it and kills the rescue arm.

So: path A (per-serving) runs first and its verdict is **terminal, including a
negative one**; path B (Atwater) is consulted only where A could not be
evaluated at all. Because B only runs where A returned no verdict, adding it
cannot change the outcome for any entry that has per-serving data.

### Why Atwater is the right discriminator, not just coverage

The replace-arm exists to rescue genuinely broken OFF entries, and this
preserves that:

| OFF entry | Atwater | Outcome |
|---|---|---|
| Energy typo'd, macros real ("sugar at 50 kcal/100 g") | 400 vs 50 → mismatch | still replaced ✓ |
| Coherent real label (Nutella 533 vs 539) | match | shielded ✓ |
| All fields jointly wrong but coherent | match | shielded — the trade-off this doc already accepted, now wider |

Frame the property as **internal arithmetic coherence**, not "independently
entered fields agreeing" (the original write-up's phrasing above). OFF often
derives per-serving from per-100g and kcal from kJ, so that claim is partly
tautological for *both* paths. Coherence is the honest claim.

### Two load-bearing guards

- **`calories > 0`.** Zero-energy entries must stay with the explicit-zero
  branch and its `kjContradicts` guard. A naive check reads a placeholder-zero
  stub as `0 ≈ 0` and would shield known-bad entries — this alone would have
  broken three existing fixtures (peanut-butter stub, granola bar with kcal 0
  beside `energy_100g: 1700`, mineral water with trace kJ).
- **protein/carbs/fat all PRESENT** (zeros fine, `undefined` not). Treating a
  missing macro as `0` yields an estimate of 0 for a macro-less entry, and
  `valuesMatch`'s `<2` absolute floor (`|1-0| <= 1`) would then shield a
  `calories: 1` entry with no macro data at all.

### The fiber band must be clamped asymmetrically

Whether OFF's `carbohydrates_100g` includes fiber is not knowable per product —
OFF carries both conventions — so accept a band rather than a one-sided
correction. The two endpoints need **different** guards:

- **US convention** (carbs INCLUDE fiber → plain sum over-counts): subtract
  `2 × min(fiber, carbs)`. Clamping to carbs is correct because fiber is a
  subset of carbs here.
- **EU convention** (carbs EXCLUDE fiber → plain sum under-counts): add
  `2 × fiber`, **unclamped**. Fiber is disjoint from carbs here and legitimately
  exceeds it — psyllium husk is ~80 g fiber to ~2 g carbs — so reusing the carbs
  clamp collapses the adjustment for exactly the products this endpoint serves.

A one-sided *subtraction* would be worse than inert: a live 14-product probe
found the plain sum **under**-counts stated energy in 11 of 14 products (muesli
433 vs 462, crisps 504 vs 536, Nutella 533 vs 539), the signature of the EU
convention dominating OFF.

Tolerance is 0.25, wider than path A's 0.15, because the Atwater model carries
systematic error path A's pure arithmetic does not: sugar alcohols (~2.4 kcal/g),
ethanol (7 kcal/g, absent from the macro sum entirely), organic acids, rounding.

### Reusable gotcha: a fixture can silently stop testing its own premise

Four pre-existing fixtures across two files claimed to test "OFF's energy is
wildly wrong, CNF rescues" but set `carbohydrates_100g: 12` for granulated sugar
(~100 g/100 g in reality) — the carbs were scaled down by the same ~8× as the
energy, one even annotated `// WRONG`. Written before any coherence check
existed, nothing constrained them to be realistic, so they actually modelled a
*uniformly* wrong, self-coherent entry: a scenario no internal check can detect
by construction, and one this doc had already accepted as shielded.

They were corrected to realistic macros so they model an energy-only error and
now pin the rescue via a genuine self-contradiction. **When adding a consistency
check, audit existing fixtures for values that were arbitrary when written and
have since become load-bearing** — a fixture that fails a new check may be
telling you it never encoded the scenario its name claims, not that the check is
wrong. Distinguish the two by re-deriving the fixture from the real-world product
it names.

### Still true, still human-only

The `barcodeNutrition` first-write-wins cache does not self-heal. Verified
2026-07-24: after the fix the API returns 539 while the row still reads
`source: cnf, calories: 182.00`. The app scan path is unaffected (`lookupBarcode`
only ever writes that cache), but `server/routes/public-api.ts` serves the stale
row. Remediation remains a manual, human-executed sweep — see the note above.

## Related Files

- `server/services/barcode-lookup.ts` — `offSelfConsistent` + the demoted `reconcilePer100g` call; `+self-consistent` source marker; `ABSOLUTE_TOLERANCE_FLOOR_KCAL`; `offMacrosCohereWithEnergy` + `ATWATER_TOLERANCE` (2026-07-24 path B)
- `server/services/nutrition-lookup.ts` — `offNutrimentsSchema` gained `energy-kcal_serving`/`energy_serving`
- `server/services/__tests__/barcode-lookup.test.ts` — McSweeney's regression, kJ-only, boundary, and guard tests; low-cal absolute-floor fixtures
- `server/lib/verification-consensus.ts` — `valuesMatch`'s `tolerance` param, now shared between verification consensus and this gate
- `server/lib/__tests__/verification-consensus.test.ts` — `tolerance`-param boundary tests

## See Also

- [Cross-validation between primary and secondary data sources](../design-patterns/cross-validation-between-data-sources-2026-05-13.md) — the original pattern this bug refines: its replace-on-discrepancy arm assumed the secondary outranks a suspect primary
- [A data-trust/label flag derived from secondary-source agreement instead of the provenance signal it's meant to represent](trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md) — sibling lesson: trust signals must derive from provenance, not correlation
- [A persisted serving-size label and its scaled nutrition values must derive from the same base](persisted-label-desyncs-from-its-scaled-companion-values-2026-07-16.md) — the same subsystem's label/value coherence rule
