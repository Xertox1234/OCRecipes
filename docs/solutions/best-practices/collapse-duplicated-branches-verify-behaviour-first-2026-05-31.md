---
title: 'Collapsing ''duplicated'' branches into a helper — verify behaviour is identical first, pin with tests'
track: knowledge
category: best-practices
module: server
tags: [refactoring, architecture, testing, code-quality, behaviour-preservation]
applies_to: [server/services/**/*.ts, server/lib/**/*.ts]
created: '2026-05-31'
last_updated: '2026-06-02'
---

# Collapsing "duplicated" branches into a helper — verify behaviour is identical first, pin with tests

## When this applies

An audit (or your own eye) flags several branches that "look identical" and
recommends collapsing them into one helper — e.g. a code-quality finding like
"these three reconciliation branches each re-assemble the same object with `??`
gap-fills; extract a helper." You are doing a **behaviour-preserving** refactor:
the acceptance criterion is "behaviour unchanged."

Before you extract, **prove the branches actually produce the same outputs for
the same inputs.** Superficially-similar branches frequently differ on one
hidden axis (which side wins a tie, whether a discrepancy *replaces* vs only
*gap-fills*, a ratio computed in the opposite direction). A naive collapse onto
the literal helper signature the finding suggests will silently change
behaviour — same inputs, opposite outputs.

## Why

This is exactly what happened collapsing `lookupBarcode`'s three Step-4
cross-validation branches into `reconcilePer100g` (`server/services/barcode-lookup.ts`):

- The **USDA-UPC-primary** branch *never* replaces the primary on a calorie
  discrepancy — it only ever gap-fills (`source` stays `"usda"`).
- The **OFF-primary** branch *does* replace with the secondary on discrepancy
  (`source` becomes the secondary's).
- A third sub-case (OFF positive but secondary calories `0`) falls through both
  arms and keeps OFF — a naive `prefer ? secondary : primary` boolean breaks it.

The literal 3-arg signature the audit proposed
(`reconcilePer100g(primary, secondary, secondarySource)`) **could not** reproduce
this: identical inputs, opposite outputs. The fix was to **extend the
signature** to carry the per-branch policy
(`primaryLabel`, `preferSecondaryOnDiscrepancy`) so one helper body — with the
`??` gap-fill literal appearing exactly once — reproduces every original branch.

> **The behaviour-unchanged criterion outranks the literal-signature criterion.**
> If the audit's suggested signature can't preserve behaviour, extend it and note
> the deviation; do not contort the code toward the literal spec.

A second discovery: refactoring a tangle often surfaces a **dead/unreachable
branch** (here, the USDA-UPC-only path can never cross-validate, because the
cross-validation search terms are built solely from the absent OFF product, so
the secondary is always null there). In a behaviour-preserving refactor you
**preserve it faithfully** (route it through the new helper so it returns the
same result) and **surface it for separate triage** — never "fix" it inline,
which would turn a mechanical refactor into a behaviour change you'd have to
defend.

### Triage resolution (2026-05-31): dead USDA-UPC cross-validation branch removed

The dead branch surfaced above was triaged under
`todo 2026-05-31-barcode-lookup-dead-usda-upc-branch`. The chosen resolution was
**remove + document**, not "enable cross-validation":

- The USDA-by-UPC call site now assigns `per100g`/`source` directly as
  authoritative, bypassing `reconcilePer100g` entirely, with an inline comment
  explaining why no cross-validation occurs (the secondary is structurally null
  because cross-validation terms are derived from the absent OFF product).
- The alternative — deriving secondary search terms from the USDA product name
  to enable cross-validation — was rejected because the data pipeline treats
  USDA-by-UPC data as authoritative, and no wrong results had ever been produced
  by the dead branch.

**Key reusable insight:** The same behaviour-preserving regression test added
during the refactor (which mocks CNF with matching data and asserts USDA values
pass through unchanged — e.g. fiber stays `0` not `3`) is what now guards the
structural invariant after the branch is removed. The test, not just a comment,
prevents a future refactor from accidentally enabling cross-validation by
introducing a secondary that would overwrite authoritative USDA data.

### Hardening the structural invariant (2026-05-31)

The regression test described above catches a future *behavioural* change that
reassigns `per100g` when the secondary is present, but it does not enforce the
*structural* invariant that `secondaryPer100g` is always null in that path. To
make the invariant self-enforcing against a future refactor that might
introduce a non-null secondary, use a **DEV/TEST-THROW + PROD-LOG-FALLBACK**
guard:

```
if (invariantViolated) {
  if (process.env.NODE_ENV !== "production") throw new Error(msg);
  else log.error(ctx, msg);
}
```

This pattern works as a self-enforcing tripwire: existing path tests already
drive the guarded branch — the day a refactor breaks the invariant, those tests
produce the violating value and the non-production throw turns CI red
automatically, with no new test harness needed. A pure `log.error` would let
those same tests stay green and the regression would ship undetected. The
production log fallback respects the constraint that the code "must never throw
on a legitimate live input" — safe because the invariant provably holds for all
current inputs (the full suite passing is the empirical confirmation that
neither guard branch fires).

**Concrete application:** in `server/services/barcode-lookup.ts` the USDA-UPC-only
path now guards `secondaryPer100g !== null` with this pattern. The existing
tests at `server/services/__tests__/nutrition-lookup.test.ts:331` and `:388`
drive that branch, so they become the CI tripwire. Adding the guard costs
~5 lines and zero test maintenance; removing it requires consciously disabling
the safety net.

### Counterpoint (2026-06-02): when only the post-normalization fallback differs, keep policy at the callers

The thesis of this solution is "extend the helper signature to carry the
per-branch policy." The `normalizeRecipeFields` refactor
(`server/lib/recipe-normalization.ts`) is the **inverse** case and equally
important to recognise.

Four recipe‑create call sites
(`server/routes/meal-plan.ts`, `server/routes/recipes.ts`,
`server/routes/recipe-import.ts` ×2) each invoke the same five
`normalize*` functions but are **not byte‑identical**: they differ only in
post‑normalisation fallback (meal‑plan stores `null`; `recipes.ts` falls back
to the AI original via `?? generatedRecipe.description`; `recipe-import.ts`
falls back to empty string via `?? ""`) and in instructions‑presence handling
and ingredient wrapping. The **core computation**
(`normalizeTitle` / `normalizeDescription` / `normalizeDifficulty` /
`normalizeInstructions` / `normalizeIngredient`) is identical everywhere.

**Discriminator rule:** does the *core computation* differ per branch, or only
what the caller *does with the result*? If only the post‑result
fallback/wrapping differs, keep that policy at the callers and have the helper
do **only the shared transform** — adding policy flags to the helper would
re‑import the divergence you are trying to delete.

`normalizeRecipeFields` returns only the keys present in the input
(spread‑friendly) so each caller's presence/fallback semantics are preserved;
callers keep their own `?? ""` / `?? original` / store‑`null` and their own
ingredient wrapper objects.

**Second gotcha (one‑liner worth recording):** a nullable helper return type
widens a caller's field type and reddens `tsc` even when `null` is *unreachable*
at runtime. Here `normalizeRecipeFields` returns `instructions?: string[] | null`
but meal‑plan's input is `string[] | undefined` (Zod optional, never `null`),
so `null` can never occur — yet `tsc` errored at the storage call because the
type widened. Fix: coalesce `?? undefined` at the boundary
(`instructions: normalizedInstructions ?? undefined`), a runtime no‑op that
re‑narrows the type.

**Third point:** the meal‑plan instructions‑absent path (`undefined` must stay
`undefined`, **not** coerce to `[]`) is the exact branch a naive collapse
breaks silently — pin it with a **unit** test, since route‑level tests may not
exercise meal‑plan‑create‑without‑instructions.

### Second concrete application (2026-06-02): cacheNutrition + cacheNutritionIfAbsent → writeNutritionCache

The two functions `cacheNutrition` (upsert via `setNutritionCache`) and `cacheNutritionIfAbsent` (insert-or-ignore via `setNutritionCacheIfAbsent`) in `server/services/nutrition-lookup.ts` were **genuinely identical** in their core computation — unlike the barcode-lookup case — differing only in storage method and log label ('cache write error' vs 'cache seed write error'). The collapse to `writeNutritionCache(query, data, { allowOverwrite })` is the textbook “extend the signature to carry per‑branch policy” case from this solution's thesis.

**Reusable nuance:** the per‑branch policy here is a **security policy** — `allowOverwrite: false` maps to `onConflictDoNothing` to prevent cache poisoning from user‑supplied barcodes. When collapsing, the flag must be named and defaulted so that a future caller cannot accidentally flip a poisoning‑guarded seed write into an overwrite. Therefore, `allowOverwrite` is an **explicit required field** (no default), forcing every caller to state intent.

There were zero existing unit tests specific to the two functions, but the full suite (5592 tests) passing — exercising both call paths via `lookupNutrition`/`batchNutritionLookup` and the photos label‑seed route — empirically confirmed behaviour preservation.

```typescript
// Usage at call sites:
writeNutritionCache(query, data, { allowOverwrite: true });   // cacheNutrition
writeNutritionCache(query, data, { allowOverwrite: false });  // cacheNutritionIfAbsent
```

## Procedure

1. **Trace every branch's outcome by hand.** For each branch, write down the
   output for the representative input classes (both-present-and-agree,
   both-present-and-disagree, primary-missing, secondary-zero). Find the axis on
   which they differ — there usually is one.
2. **Pin the under-tested branches with tests against the *current* code,
   first.** Add a test, watch it pass on the un-refactored code, *then* refactor.
   The branch the existing suite doesn't cover is precisely the one a naive
   collapse breaks silently. (Two such tests were added here before touching the
   logic: the no-cross-validation USDA-UPC path and the secondary-zero-calories
   "keep primary" case.)
3. **Extend the helper signature to carry the policy difference** rather than
   forcing the literal spec. One body, the gap-fill literal appearing once,
   per-branch behaviour selected by a flag/label argument.
4. **Preserve dead branches faithfully; surface them, don't fix them.** Route the
   unreachable branch through the new helper and report it as an out-of-scope
   finding.
5. **Re-run the full suite** — behaviour preservation is only proven by green
   tests, not by code that "looks equivalent."

## Related Files

- `server/services/barcode-lookup.ts` — `reconcilePer100g` (the extended-signature helper) and `lookupBarcode` (the two call sites)
- `server/services/nutrition-lookup.ts` — `mapUsdaFoodToNutrition` (a genuinely-identical-branch collapse, where dropping `|| 0` was safe because the Zod schema coerces `value: null -> 0` upstream) and `writeNutritionCache` (genuinely-identical collapse with `allowOverwrite` policy flag)
- `server/services/__tests__/nutrition-lookup.test.ts` — the two regression tests added before the refactor
- `server/lib/recipe-normalization.ts` — `normalizeRecipeFields` helper (shared‑transform only, no fallback policy)
- `server/routes/meal-plan.ts` — caller that keeps `null` for absent fields
- `server/routes/recipes.ts` — caller that falls back to AI‑original via `?? generatedRecipe.description`
- `server/routes/recipe-import.ts` — caller with two call sites, falls back to `""` for absent fields

## See Also

- [Widening a shared helper's dependency surface](widening-helper-dependency-surface-test-blast-radius-2026-05-25.md) — the complementary refactoring hazard (caller-test blast radius when a helper gains a dependency)
- [Cross-validation between data sources](../design-patterns/cross-validation-between-data-sources-2026-05-13.md) — the domain pattern these branches implement
