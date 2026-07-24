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
15%-boundary fixtures. **(Superseded 2026-07-24: "entries missing per-serving
energy (most of OFF)" is the MAJORITY of the corpus, not a rare edge — leaving
them replace-on-discrepancy was a systematic hole. See
`## Refinements shipped (2026-07-24)` below.)**

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

## Refinements shipped (2026-07-24, todo P2-2026-07-22-barcode-nutriment-source-pollution)

The per-serving-only gate above left a **systematic hole**: "entries missing
per-serving energy (most of OFF)" is the majority of the database, not a rare
edge. Live failure (Nutella, barcode `3017620422003`): OFF had the per-100g
exactly right (539 kcal, 6.3 protein, 57.5 carbs, 30.9 fat, 56.3 sugar) but no
`serving_size` and no per-serving energy, so `offSelfConsistent` returned false
on its first guard, `preferSecondaryOnDiscrepancy` stayed true, and a CNF
category name-match ("spreads", 182 kcal — a different food) replaced OFF's
correct label wholesale. Downstream, PR #694's FSA flags mis-fired (no
`nutrient:sugar` for a 56 g-sugar product, because they evaluated the polluted
3.1 g).

**Fix — a second, independent corroboration path** (`server/services/barcode-lookup.ts`):
when per-serving energy is absent, fall back to an **Atwater
energy-vs-own-macros** check — `offMacrosCorroborateEnergy`, `4·protein +
4·carbs + 9·fat` vs the stated per-100g energy, within
`ATWATER_MACRO_TOLERANCE = 0.3`. An entry whose energy agrees with its own
macros is self-consistent even without a per-serving field, so the
name-matched secondary is demoted to gap-fill. The existing per-serving,
zero-agreement, and kJ-contradiction branches are byte-preserved (they run only
when both per-serving and per-100g energy are defined).

**Reusable lesson — a self-consistency gate keyed on ONE corroboration field
fails OPEN for every record lacking that field.** The original gate required
per-serving energy (three independently-entered fields agreeing); most of OFF
carries only per-100g, so the gate silently degraded to "no protection" for the
majority. When a gate's premise is "these independent fields corroborate each
other," check what fraction of REAL records carry ALL those fields — and supply
a fallback corroboration from a DIFFERENT independent field set (here, the
entry's own macros) for the records that don't.

**Fiber is deliberately excluded from the Atwater sum.** OFF aggregates labels
from multiple regulatory regimes — EU 1169/2011 ("carbohydrate" EXCLUDES fibre)
and US FDA ("Total Carbohydrate" INCLUDES fibre) — and stores whichever was
transcribed, so the sign of any per-entry fiber correction is unknowable.
Ignoring fiber caps worst-case error at 2·fiber kcal either way; adding OR
subtracting would be off by 4·fiber for the wrong convention. The 30% tolerance
absorbs the residual for all but extreme-fiber products (near-pure
psyllium/bran), an accepted unshielded residual. (A reviewer initially proposed
*subtracting* fiber, assuming the US convention — verifying the data source's
actual, mixed provenance before applying the suggestion was load-bearing.)

**Accepted trade-off, now widened.** As with the 2026-07-17 per-serving gate,
an entry whose energy and macros are jointly wrong yet mutually consistent is
now shielded from the cross-check — previously confined to per-serving entries,
this now covers the no-per-serving population too. Pinned by a dedicated
"jointly-wrong-but-Atwater-consistent" guard test.

**Cache remediation — the poisoned population is now WIDER.** Because the
fallback protects most of OFF (not just per-serving entries), more historical
`barcodeNutrition` rows were written wrong under the old policy. First-write-wins
means they do NOT self-heal — the manual, human-executed sweep + delete/re-seed
from `## Prevention` above now covers this wider set. Follow-up:
`todos/P2-2026-07-24-barcode-cache-poisoned-rows-remediation.md` (human-led;
never run autonomously, same guardrail as the 2026-07-17 sweep).

## Follow-up shipped (2026-07-24, todo P3-2026-07-24-atwater-fallback-when-serving-grams-unparseable)

The Atwater fallback above was initially reached only when per-serving energy
was **absent**. A second population was still falling through to `return false`:
entries whose per-serving energy IS present and positive, but whose
`serving_size` yields no parseable grams (`"1 bottle"`, a fl-oz-only US label).
The ratio check cannot run there either, so those entries were declared
unshielded and handed to a name-matched secondary.

The distinction that resolves it — and the reusable one:

> **A signal that could not be evaluated is not a signal that failed.** Unparseable
> grams are a *missing* input, not a detected contradiction. Only a check that
> actually ran and disagreed should override a corroboration path; a check that
> could not run should defer to whatever weaker signal remains.

So the compound guard was split by which condition means what:

```typescript
if (offPerServingCal <= 0 || offPer100g.calories <= 0) {
  return false;                                  // unchanged
}
if (offLabelGrams === null || offLabelGrams <= 0) {
  return offMacrosCorroborateEnergy(offPer100g); // missing input → weaker signal
}
// grams parse → the per-serving × grams ratio check stays authoritative,
// INCLUDING when it disagrees.
```

The load-bearing test here is not the happy path but its mirror: an entry with
**parseable** grams and a contradictory `energy-kcal_serving` whose macros *would*
have satisfied Atwater. Without it, nothing pins that the ratio arm's verdict
still outranks the fallback, and a later refactor could quietly let the fallback
swallow the contradictions the replace-arm exists to surface.

## Related Files

- `server/services/barcode-lookup.ts` — `offSelfConsistent` + the demoted `reconcilePer100g` call; `+self-consistent` source marker; `ABSOLUTE_TOLERANCE_FLOOR_KCAL`; (2026-07-24) `offMacrosCorroborateEnergy` + `ATWATER_MACRO_TOLERANCE` Atwater fallback for the no-per-serving-energy population
- `server/services/nutrition-lookup.ts` — `offNutrimentsSchema` gained `energy-kcal_serving`/`energy_serving`
- `server/services/__tests__/barcode-lookup.test.ts` — McSweeney's regression, kJ-only, boundary, and guard tests; low-cal absolute-floor fixtures
- `server/lib/verification-consensus.ts` — `valuesMatch`'s `tolerance` param, now shared between verification consensus and this gate
- `server/lib/__tests__/verification-consensus.test.ts` — `tolerance`-param boundary tests

## See Also

- [Cross-validation between primary and secondary data sources](../design-patterns/cross-validation-between-data-sources-2026-05-13.md) — the original pattern this bug refines: its replace-on-discrepancy arm assumed the secondary outranks a suspect primary
- [A data-trust/label flag derived from secondary-source agreement instead of the provenance signal it's meant to represent](trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md) — sibling lesson: trust signals must derive from provenance, not correlation
- [A persisted serving-size label and its scaled nutrition values must derive from the same base](persisted-label-desyncs-from-its-scaled-companion-values-2026-07-16.md) — the same subsystem's label/value coherence rule
