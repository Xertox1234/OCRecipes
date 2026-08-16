---
title: "Decide whether the saved-item path should populate servingSizeGrams at all — the follow-on's original premise is superseded"
status: completed
priority: low
created: 2026-08-15
updated: 2026-08-15
assignee:
labels: [deferred, hooks, client-state]
github_issue:
---

# Should the saved-item path populate `servingSizeGrams`?

## Summary

PR #819 left `servingSizeGrams` null on the saved-item path and made
`effectivePer100g` return `null` rather than fabricate a basis from it. Its parent todo
carried an optional follow-on: parse `existingItem.servingSize` and call
`setServingSizeGrams` so a real basis exists there. **That follow-on's stated payoff is
already delivered by other code**, and implementing it as written would now cut against a
deliberate design choice. This todo exists to make that call explicitly and record it —
not to implement the parse on the assumption it is still wanted.

## Background

The parent todo (`todos/archive/P2-2026-07-31-effective-per100g-fabricates-basis-on-saved-item-path.md`)
justified the follow-on this way:

> Fixing it would let saved items show bands instead of degrading, which is the
> user-visible payoff.

**That is no longer true.** `client/components/nutrition/nutrition-band-source.ts`
resolves the band basis on the saved-item path itself, and does not read
`servingSizeGrams` or `effectivePer100g` at all:

```ts
// selectBandSource, saved-item branch (:150-163)
return {
  values: input.nutrition,
  basis: resolveBasis({
    valuesArePer100: false,
    servingSize: input.nutrition.servingSize, // ← parses the stored string itself
    isBeverage: input.isBeverage,
  }),
  portionGrams:
    parseServingBasis(input.nutrition.servingSize)?.quantity ?? null,
};
```

Its own comment at `:143-146` states the intent: _"resolveBasis back-calculates from the
stored serving string — never from a `|| 100` default."_ Saved-item bands work today.

The follow-on would therefore add a **second, independent parse of the same string** into
a different piece of state. That is precisely the drift the band module's comment at
`:157-160` was written to prevent:

> The SAME string `resolveBasis` derives `factor` from, through the same parser — so the
> portion weight and the per-100 denominator can never describe different portions.

Two parses of one string, feeding two consumers, is how those two silently come to
describe different portions.

### There is no live gap to close

Every non-test consumer of `servingSizeGrams` is behind
`showServingControls = !itemId && !!barcode && nutrition?.calories !== undefined`
(`NutritionDetailScreen.tsx:261`) — verified 2026-08-15:

| Consumer                                         | Site                              | Reachable with `itemId` set?                                                                    |
| ------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ServingControls` (chips, stepper, custom input) | `NutritionDetailScreen.tsx:437`   | No — `showServingControls` gate                                                                 |
| `getServingContextLabel`                         | `nutrition-detail-utils.ts:72-90` | No — rendered as `showServingControls ? servingContextLabel : undefined` (`:538`)               |
| `servingOptions`' `\|\| 100`                     | `useNutritionLookup.ts:242`       | Computed, but only read by `ServingControls`                                                    |
| `effectivePer100g`                               | `useNutritionLookup.ts:212`       | Returns `null` there as of #819; sole consumer `recalculateNutrition` is `ServingControls`-only |
| `nutrition-band-source`                          | `:9`, `:51`                       | **Comments only** — no read                                                                     |

So populating it today changes nothing a user can observe. The work is an enabler for a
hypothetical future consumer, and the band precedent argues that such a consumer should
parse the string it is tied to rather than trust a second copy of the answer.

## The actual question

**Is per-consumer parsing of `nutrition.servingSize` the standing pattern on the
saved-item path, or should the hook resolve the basis once into `servingSizeGrams` and
have consumers read that?**

Both are defensible. Per-consumer parsing is what shipped and it has an explicit rationale
(one string, one parser, one consumer — no cross-consumer drift). A single hook-level
resolve is the more conventional shape and avoids N parses, but it reintroduces the
possibility of the basis and the portion weight disagreeing, which is the failure the band
module names.

**Recommendation (not a decision — see Acceptance Criteria):** close as won't-do and
document per-consumer parsing as the pattern. The enabler has no consumer, no user-visible
effect, and a live precedent arguing against it. But this is the user's call, not the
implementer's.

## Acceptance Criteria

- [x] The question above is answered explicitly by a human, not inferred
- [x] **If per-consumer parsing stands:** the rationale is recorded where the next person
      will hit it — a short note on `servingSizeGrams`' initialiser in
      `client/hooks/useNutritionLookup.ts` pointing at
      `nutrition-band-source.ts:143-163` as the worked precedent. Then archive this todo.
      No code behaviour changes.
- [ ] ~~**If hook-level resolve wins instead:**~~ NOT TAKEN — `existingItem.servingSize` is parsed with
      `parseServingBasis` from `@shared/lib/label-serving` (never a new parser, never
      `parseLabelServingGrams` — that one backs the label-readiness gates and its docblock
      forbids narrowing it), `setServingSizeGrams` is called only for a `unit === "g"`
      result, and `nutrition-band-source` is migrated to read the resolved value so there
      is exactly ONE parse of the string, not two
- [x] Either way, no change to `servingOptions`' `|| 100` at `useNutritionLookup.ts:242`
      and no change to `effectivePer100g`'s guard from #819
- [x] This todo closes with zero follow-ups — make the call, execute it, archive

## Implementation Notes

- `parseServingBasis(servingSize)` returns `{ quantity, unit: "g" | "ml" }` or `null`. It
  already handles the `scanned_items.servingSize` forms — `"1 can (355 mL)"`,
  `"(198g/7oz)"`, `"30g"`, `"250 grams"` — and returns `null` for `"1 bottle"`,
  `"1 serving"`, `"0 ml"`, and `"0g"`. Pinned by `shared/lib/__tests__/label-serving.test.ts`.
- The `ml` case is not a detail to skip: `servingSizeGrams` is named for grams and
  `recalculateNutrition` writes `` `${grams}g` `` into `servingSize`. Feeding it a
  millilitre quantity would caption a drink in grams. `resolveBasis` keeps the unit for
  exactly this reason.
- A corrected serving is stored as `~355g (estimated)`, which `parseServingBasis`
  deliberately does **not** parse (the `~` defeats its token anchor) — see
  `nutrition-band-source.ts:72` and its test at
  `client/components/nutrition/__tests__/nutrition-band-source.test.ts:136`. Any new caller
  inherits that behaviour; do not "fix" it to accommodate this todo.

## Scope Contract

- **Mechanisms to use:** the existing `parseServingBasis` export and the existing
  `setServingSizeGrams` setter — no new parser, no new hook, no schema change
- **Files in scope:** `client/hooks/useNutritionLookup.ts`,
  `client/hooks/__tests__/useNutritionLookup*.test.ts`, and — only on the
  hook-level-resolve branch — `client/components/nutrition/nutrition-band-source.ts` plus
  its tests
- Explicitly OUT of scope: `shared/lib/label-serving.ts` itself. Adding a caller must not
  widen or narrow either parser.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #819 (the null guard) has merged; this is independent of it and of the
  still-open server-side sibling
  `todos/P3-2026-07-30-secondary-normalization-fabricates-100g-basis.md`.

## Risks

- **The main risk is doing the work.** Two parses of one string is a drift hazard the band
  module explicitly designed against; implementing the enabler without migrating
  `nutrition-band-source` to the single resolved value creates exactly that.
- Low-value churn: on the per-consumer-parsing branch this todo produces a comment and an
  archive entry. That is the correct outcome, not a failure to deliver.

## Updates

### 2026-08-15 — CLOSED WON'T-DO (human-led decision)

**Per-consumer parsing of `nutrition.servingSize` is the standing pattern on the
saved-item path.** The hook does not resolve a gram basis there, and
`servingSizeGrams` stays null for the whole path by design.

Decided by the user, not inferred by the implementer — this todo was filed
specifically to put the call in front of a human rather than let an
already-superseded follow-on sit in the backlog looking actionable.

Executed in the same PR that filed it, so no backlog entry ever landed on `main`
needing a second close:

- A docblock on `servingSizeGrams`' initialiser
  (`client/hooks/useNutritionLookup.ts`) records why it stays null and names
  `selectBandSource`'s saved-item branch as the worked precedent — the place
  where a saved item's serving string _is_ parsed, once, feeding both the FSA
  basis and the portion weight so the two cannot disagree. It says outright: do
  not populate this by parsing `existingItem.servingSize`.
- No behaviour changed. `servingOptions`' `|| 100` and `effectivePer100g`'s #819
  guard are both untouched.

Zero follow-ups, per the decision-todo convention.

### 2026-08-15

- Filed at the user's request as the follow-on from
  `todos/archive/P2-2026-07-31-effective-per100g-fabricates-basis-on-saved-item-path.md`,
  closed by PR #819.
- Reframed from "implement the parse" to "decide whether to" after checking the premise:
  `nutrition-band-source.ts` already resolves the saved-item basis from
  `nutrition.servingSize`, so the payoff the parent todo cited is already shipped.
  Consumer table above verified against current `main` (`1e7756a4`) the same day.
