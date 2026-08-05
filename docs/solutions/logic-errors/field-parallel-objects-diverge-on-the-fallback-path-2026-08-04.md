---
title: Two objects that are usually field-parallel diverge on the fallback path
track: bug
category: logic-errors
tags: [data-integrity, fallback-path, nutrition, invariants, code-review, client, defensive-gating]
module: client
applies_to: [client/components/nutrition/**/*.ts, client/hooks/**/*.ts, client/lib/serving-size-utils.ts]
symptoms: ["A value is right on the happy path and wrong only when an upstream source degrades or is unreachable", "Two surfaces on one screen disagree about the same datum — one says Not recorded while the other makes a confident claim", "A warning stops appearing and nothing in the diff deleted a warning", "The suite is green through the defect because each half of the code is internally consistent", "Every test fixture sets both objects to the same value, so no test can tell them apart"]
created: '2026-08-04'
severity: high
---

# Two objects that are usually field-parallel diverge on the fallback path

## Problem

Code reads datum X from object **A** and datum Y from object **B**, then reasons about them as
though they describe the same thing. On the primary path A and B *are* field-parallel — one is
derived from the other by scaling, merging, or copying — so the assumption holds and every test
passes. On a fallback path, A and B are assembled **independently**, and the assumption silently
fails.

Nothing crashes. Nothing is undefined. Each half of the code is correct in isolation. The defect
lives entirely in the *relationship*, which is why neither the type system nor a passing suite
can see it.

## Symptoms

- A value renders correctly on the happy path and wrongly only when an upstream source is degraded, missing, or unreachable.
- Two surfaces on the same screen disagree about the same datum — one shows "Not recorded" while the other shows a confident claim about it.
- A warning that used to appear no longer does, and nothing in the diff deleted the warning.
- The whole test suite is green through the defect, because each half of the code is internally consistent.
- Every test fixture sets both objects to the same value, so no test can distinguish them.

## Root Cause

Slice 2c of the Nutrition Detail redesign shipped **four** instances of this shape in one branch.
All four were found by review; none by the 2730-test suite. Read them together — the point is the
recurrence, not any single case.

**1. `nutrition.servingSize` vs `validatedData.servingInfo.displayLabel`.** Banding resolved its
serving string from `nutrition.servingSize`. `recalculateNutrition` rewrites that field to
`` `${grams}g` `` when the user picks a gram serving option (`client/hooks/useNutritionLookup.ts`).
With `isBeverage` absent, `resolveBasis` infers the whole threshold table from that string's unit —
so tapping a serving chip flipped drink thresholds to food ones (sodium HIGH 300 → 600) and the
band moved. `displayLabel` is the invariant original; `nutrition.servingSize` is merely
*initialised* from it and then overwritten.

**2. "the panel owns this nutrient" vs "the panel is banding it".** A filter deleted the server's
`sugar`/`saturated_fat`/`sodium` warning badges because the panel *owned* those nutrients. The
panel only replaces them when it can actually band them. With an absent `isBeverage` **and** an
unparseable serving string — both reachable, and *correlated* on sparse OpenFoodFacts records —
the panel rendered an unbanded value while the badge was already gone.

**3. "a band exists" vs "the band agrees".** The repair for (2) dropped a badge whenever the panel
resolved *any* band. The panel deliberately passes no `portionGrams`, so it can never reproduce
the server's FSA per-portion HIGH override (`server/services/universal-flags.ts`). On Cherry Coke —
355 mL, 39 g sugar — per-100 is 10.99 against a drink HIGH line of 11.25, so the panel bands
MEDIUM while the server emits "High in sugar". The badge was deleted. On a 700 g food at 4 g/100 g
the colour inverts outright: server HIGH, client LOW, a green check dot where the red warning was.

**4. `validatedData.per100g` vs `nutrition` for `hasValue`.** `hasValue` derived from the band
source alone. On the direct-OFF fallback (server unreachable) `perServing` is assembled
field-by-field from independently-present OFF fields while `per100g` comes from the separate
`_100g` fields, and the plausibility gate inspects **calories only**. So `per100g.sugar = 11.0`
with `nutrition.sugar = undefined`: the panel showed "Sugar — Not recorded" while the summary card
promoted "Moderate sugar" with a coloured pill.

The uniting mechanism: **a fallback path assembles the two objects by different routes.** On the
primary path one is computed from the other (`perServing = scaleNutrients(per100g, scale)`), which
is exactly why the assumption looks safe when you read the happy path.

## Solution

**Gate on the source you actually render from, not on the one that is convenient to reason about.**

```ts
// WRONG — hasValue speaks for a value the UI may not be able to display.
const hasValue = typeof sourceValue === "number";

// RIGHT — the flag cannot outrun what the row can show.
const hasValue = typeof sourceValue === "number" && displayValue !== undefined;
```

Three repair shapes, in preference order:

1. **Read from the invariant source.** Instance 1's fix: take the serving string from
   `validatedData.servingInfo.displayLabel`, which no control rewrites — rather than from display
   state that does.
2. **Require agreement, not mere existence.** Instance 3's fix: drop a `warn`-severity badge only
   when the replacing surface's band is `"high"`, not whenever *some* band resolved. Existence is
   the weaker predicate and it is almost never the one you mean.
3. **Cross-check both sources at the gate.** Instance 4's fix, above. Note this is a **no-op** on
   every path where the two are genuinely parallel, which is what makes it cheap.

**Write the test against the divergence, not the happy path.** Every pre-existing test set both
objects to the same value, so all of them stayed green under both the buggy and the fixed code.
Build the fixture the way the real fallback does — an absent `isBeverage` plus a non-parsing
`displayLabel` — rather than by forcing the derived value directly, or the test proves only that
your mock works.

## Prevention

- When a filter drops signal X because "surface Y carries it now", **verify Y carries it in every
  state**, not just the state you were looking at. Write down the states where it does not.
- When two objects are field-parallel by construction, say so in a docblock **and name the
  construction** — "`perServing` is scaled from `per100g` by `scaleNutrients`" is checkable;
  "these are equivalent" is not.
- Treat "reachable only on the fallback branch" as **reachable**. Sparse upstream records are the
  norm for OpenFoodFacts, and the gaps correlate: a record missing category tags usually also lacks
  a structured serving size.
- Ask of any deletion: *what was on screen before, and what is on screen now?* Instance 2 removed a
  `severity: "warn"` health warning and the diff contained no deletion of a warning.
- Under-warning by declining to invent a signal is permitted here; **discarding a real
  server-computed signal is not**. Those are different directions and it is worth stating which one
  a change takes.

## Related Files

- `client/components/nutrition/nutrition-band-source.ts` — the adapter; its docblock now names which
  guarantee holds between which pair.
- `client/components/nutrition/FlagSections-utils.ts` — `isBandedByPanel` / `dropPanelBandedFlags`,
  the agreement predicate.
- `client/lib/serving-size-utils.ts` — `validateAndNormalizeNutrition`; the trusted branch is where
  `perServing` and `per100g` stop being parallel.
- `server/services/universal-flags.ts` — the FSA per-portion override the client cannot reproduce.

## See Also

- [Absent field beats a defaulted one in a precedence chain](absent-field-beats-defaulted-one-in-a-precedence-chain-2026-07-31.md) — the sibling failure: a confident default short-circuits the fallback that would have been right
- [A disjunctive gate whose alternatives fail to the same root cause](disjunctive-gate-alternatives-sharing-one-failure-mode-2026-07-30.md) — two conditions that look independent and are not
- [Deleting a truthiness guard drops unanalyzed falsy cases](truthiness-guard-deletion-drops-unanalyzed-falsy-cases-2026-07-30.md) — the same "which values does this actually cover" question, one level down
