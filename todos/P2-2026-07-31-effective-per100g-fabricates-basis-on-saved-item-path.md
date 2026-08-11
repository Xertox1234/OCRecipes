---
title: "effectivePer100g fabricates a per-100g basis on the saved-item path (armed by any new consumer)"
status: backlog
priority: medium
created: 2026-07-31
updated: 2026-08-10
assignee:
labels: [deferred, hooks, client-state]
github_issue:
---

# effectivePer100g fabricates a per-100g basis on the saved-item path

## Summary

`client/hooks/useNutritionLookup.ts:186-190` back-calculates a per-100 g basis with:

```ts
const grams = servingSizeGrams || 100;
const factor = 100 / grams;
```

On the saved-item path (`route.params.itemId`) `validatedData` is null — its own comment at
`:180` says so — and the `existingItem` effect at `:782-787` calls **only** `setNutrition`.
It never calls `setServingSizeGrams`, so that state stays `null` from its initialiser at
`:92`. The `|| 100` therefore yields `factor = 1`, and **per-serving values are returned
labelled as per-100 g**. `isPer100g` also stays false, so the "Values shown per 100g"
disclosure banner does not fire.

**Latent, not live — and the reason it is latent is fragile.** `effectivePer100g` has
exactly one consumer: `recalculateNutrition` (`:273`). That is reachable only from
`ServingControls`, which renders only when
`showServingControls = !itemId && !!barcode && nutrition?.calories !== undefined`
(`NutritionDetailScreen.tsx:270`). So on the saved-item path the fabricated value is
computed every render and never read.

The protection is therefore **an accident of which components happen to render**, not a
guard. Any new consumer of `effectivePer100g` that runs on the saved-item path arms the bug
immediately, with no test failure and no visible signal.

## Background

Found 2026-07-31 while designing the Nutrition Detail redesign
(`docs/superpowers/specs/2026-07-31-nutrition-detail-redesign-design.md`, "The basis
problem"). That design needs a trustworthy per-100 basis for FSA traffic-light bands, and
reading `effectivePer100g` would have been the obvious wiring.

What the wrong basis would produce, had the spec taken that route:

| Product                            | True basis      | Fabricated basis | Correct band   | Band as computed |
| ---------------------------------- | --------------- | ---------------- | -------------- | ---------------- |
| Amy's chili, 680 mg sodium / 236 g | 288 mg / 100 g  | 680 mg           | MEDIUM         | **HIGH**         |
| Cherry Coke, 39 g sugar / 355 ml   | 11.0 g / 100 ml | 39 g             | MEDIUM (drink) | **HIGH**         |

Both wrong in the alarming direction, and the same product would band differently depending
on whether it was opened from a scan or from Today.

**The redesign spec routes around this rather than depending on it** — `bandFor` takes an
explicit `Basis` and degrades to an unbanded row when it cannot be resolved. So this todo is
not a blocker for that work. Fixing it would let saved items show bands instead of degrading,
which is the user-visible payoff.

### This is the third instance of one defect shape, and it is NOT the open sibling

Do not conflate these — they are different files and different liveness:

| Instance                                | Site                                    | Status                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `servingInfo.grams ?? 100`              | client, `recalculateNutrition`          | **Fixed** — PR #740, replaced by the `!(grams > 0)` guard at `:246`                                                                                                    |
| `parseFloat(data.servingSize) \|\| 100` | `server/services/barcode-lookup.ts:219` | Open — `todos/P3-2026-07-30-secondary-normalization-fabricates-100g-basis.md`. Different file, cross-validation secondary, latent against all three current producers. |
| `servingSizeGrams \|\| 100`             | client, `effectivePer100g:189`          | **This todo.**                                                                                                                                                         |

There is a fourth `|| 100` at `:216` (`servingOptions`) which is **correct and out of
scope** — it builds a display option list, and its sibling at `barcode-lookup.ts:723` pairs
its fallback with `isServingDataTrusted` so the client derives `isPer100g === true` and
discloses it.

## Acceptance Criteria

- [ ] `effectivePer100g` returns `null` when the gram basis cannot be established, rather
      than fabricating `factor = 1` from `|| 100`
- [ ] The guard rejects a non-positive basis, not only `null` — `0` currently passes `||`
      but would divide to `Infinity`
- [ ] `recalculateNutrition`'s existing behaviour is **unchanged** for every case that works
      today: it already returns early on `!effectivePer100g` (`:273`), so a null must fall
      into that path, not into the per-serving branch at `:246`
- [ ] A test proves that on the saved-item path (`itemId` set, `servingSizeGrams` null)
      the basis is unresolvable — pinning that a future consumer cannot silently read a
      fabricated one. **`effectivePer100g` is NOT directly assertable**: it is an
      internal `useMemo` and is not on the hook's return surface. Observe it through
      `recalculateNutrition`, which the hook **does** return (`:981`) and which a test
      can therefore call without `ServingControls` ever rendering: on the saved-item
      path it must early-return on `!effectivePer100g` and leave `nutrition` untouched.
      Exporting the memo instead is acceptable **only** if the reviewer agrees widening
      the hook's public surface is worth it — prefer the behavioural assertion
- [ ] A test covers the scan path with `validatedData` present, proving it still returns
      `validatedData.per100g` byte-identically
- [ ] A test covers `servingSizeGrams === 0` proving it yields null, not `Infinity`
- [ ] `servingOptions`' `|| 100` at `:216` is **unchanged**

## Implementation Notes

- The change is local to the `useMemo` at `:186-210`. Replace
  `const grams = servingSizeGrams || 100` with an explicit positive-number check and an
  early `return null`.
- Verify the dep array at `:210` still lists `servingSizeGrams` — it does today.
- **Optional follow-on, only if it stays contained:** recover a real basis on the saved-item
  path by parsing `existingItem.servingSize` (a `text` column such as `"1 can (355 mL)"`)
  and calling `setServingSizeGrams`. `shared/lib/label-serving.ts` already parses those
  forms and distinguishes `g` from `ml`. Its docblock warns it **must stay at least as
  permissive as its predecessors** — adding a caller must not narrow it. Treat this as a
  separate commit so the null-guard can land alone if it turns out to have reach.

## Scope Contract

- **Mechanisms to use:** a nullable return on the existing `useMemo` — no new abstraction,
  no new hook, no schema change
- **Files in scope:** `client/hooks/useNutritionLookup.ts`,
  `client/hooks/__tests__/useNutritionLookup*.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Independent of the `barcode-lookup.ts:219` sibling todo and of the Nutrition Detail
  redesign (which routes around this rather than depending on it).

## Risks

- `effectivePer100g` is memoised and read inside a `useCallback` whose dep array includes it
  (`:296`). Returning null changes the identity churn slightly; confirm no render loop.
- The saved-item path is the _quiet_ one — it has no serving controls and no log button, so
  a regression there is less likely to be noticed in manual testing. Lean on the tests.

## Updates

### 2026-08-10 — ACs amended, line citations re-verified

Triaged during the PR #794 session; **not started**, still `backlog`.

- **One AC was unsatisfiable as written** and would have blocked whoever picked this up:
  it demanded a test asserting `effectivePer100g` is null, but that value is an internal
  `useMemo` with no path out of the hook. Rewritten above to assert the observable
  consequence via `recalculateNutrition` (which _is_ returned), with exporting the memo
  as an explicitly-reviewed fallback rather than an accident.
- **Every line citation in this file has drifted** — PR #792 deleted the duplicate iOS
  announcer above them. Re-verified against current `main`:
  `effectivePer100g` `:186-190` → **`:212-216`**; `servingOptions`' out-of-scope
  `|| 100` `:216` → **`:242`**; `recalculateNutrition`'s early return `:273` →
  **`:299`**; the initialiser `:92` and the `existingItem` effect `:782-787` were not
  re-checked. Re-locate by symbol, not by line.
- The latency argument still holds: `effectivePer100g`'s only consumer is still
  `recalculateNutrition` (`:299`/`:301`), and `showServingControls` is still gated on
  `!itemId` (`NutritionDetailScreen.tsx:261`). Slice 2c relocated markup around it
  without adding a reader.

### 2026-07-31

- Filed during the Nutrition Detail redesign design session. Verified latent by tracing all
  consumers of `effectivePer100g`: the sole reader is `recalculateNutrition`, gated behind
  `ServingControls`, which does not render when `itemId` is set. Initially reported as live;
  that was wrong and is corrected here.
