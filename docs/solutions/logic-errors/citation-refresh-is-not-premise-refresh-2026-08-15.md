---
title: Re-verifying a stale item's citations is not re-verifying its premise — and the citations are the part that looks like diligence
track: bug
category: logic-errors
tags: [harness, hooks, client-state, decision-records, technical-debt, code-review]
module: shared
applies_to: ["client/hooks/**/*.ts", "docs/solutions/**/*.md", "todos/**/*.md"]
symptoms: ["a deferred item carries a dated triage entry that re-checked every file:line citation but not the reason the work was wanted", "the described work is still implementable exactly as written, and would still be wrong to do", "the payoff sentence names a user-visible outcome that some other module already delivers", "acting on the item would add a second producer of a value something else already computes"]
created: 2026-08-15
severity: medium
---

# Re-verifying a stale item's citations is not re-verifying its premise

## Problem

A deferred item (todo, spec follow-on, decision record) makes two independent classes of
claim:

1. **Citations** — "the guard is at `:186-190`", "its only consumer is `recalculateNutrition`".
2. **Premise** — "fixing this would let saved items show bands instead of degrading, which
   is the user-visible payoff."

Citations rot loudly: a line moves, a symbol is renamed, and a grep or a failed jump
exposes it immediately. **Premises rot silently.** Nothing in the file changes when some
other module ships the outcome the item was written to deliver.

The trap is that re-verifying the citations *feels* like re-verifying the item. It is
visible, effortful diligence that produces a clean, dated triage note — and it leaves the
one claim that decides whether the work should happen at all completely unexamined.

## Symptoms

- A dated triage entry that re-checks every `file:line` and explicitly says so, with no
  corresponding line about *why* the work was wanted.
- The item is still perfectly implementable as written. Staleness here does not look like
  breakage; it looks like a ready ticket.
- The payoff sentence names a user-visible outcome, and some other module now produces
  that outcome by a different route.
- Implementing the item would introduce a **second** producer of a value another module
  already derives — often from the same input.

## Root Cause

Worked example, 2026-08-15. `todos/…-effective-per100g-fabricates-basis-on-saved-item-path.md`
carried an optional follow-on: parse `existingItem.servingSize` into `servingSizeGrams` so
the saved-item path has a real gram basis. Its stated payoff:

> Fixing it would let saved items show bands instead of degrading, which is the
> user-visible payoff.

That todo **was** triaged, on 2026-08-10, and the triage was thorough:

> **Every line citation in this file has drifted** — PR #792 deleted the duplicate iOS
> announcer above them. Re-verified against current `main`: … Re-locate by symbol, not by
> line.

Every citation re-derived. The premise never mentioned. And in the interval,
`client/components/nutrition/nutrition-band-source.ts` had grown a saved-item branch that
resolves the band basis straight from `nutrition.servingSize`:

```ts
basis: resolveBasis({ valuesArePer100: false, servingSize: input.nutrition.servingSize, … }),
portionGrams: parseServingBasis(input.nutrition.servingSize)?.quantity ?? null,
```

Saved-item bands already worked. The payoff was delivered — and the follow-on had inverted
from "enabler" to "counter-indicated", because implementing it would add a second,
independent parse of the same string, which that module's own comment exists to prevent:

> The SAME string `resolveBasis` derives `factor` from, through the same parser — so the
> portion weight and the per-100 denominator can never describe different portions.

The parent spec had said it would "route around this rather than depend on it." It did.
Nobody went back and asked what that meant for the follow-on's justification.

## Solution

Before acting on any deferred item, verify its **premise** as a first-class step, distinct
from re-locating its citations:

1. **Find the payoff sentence** — the clause naming what gets better. If there isn't one,
   that is itself the finding: an item with no stated payoff cannot be triaged, only
   guessed at.
2. **Ask who else could deliver it now.** Search for the *outcome*, not the item's own
   symbols. Here the item was about `servingSizeGrams`; the answer lived in a module that
   never mentions it.
3. **Check for a second-producer inversion.** If the work would compute a value another
   module already derives, the item has flipped sign — the correct output is a decision,
   not an implementation.
4. **Record the premise check in the triage note**, even when it holds. "Payoff re-checked
   2026-08-15, still unmet" is one line and it stops the next triager re-deriving it.

When the premise is dead, close the item as a **decision** carrying the evidence — and put
the rationale where the next person hits it (a comment at the state or symbol in question),
not only in the archived file. See
[[null-guard-hoisted-above-the-branch-that-survives-the-null-2026-08-15]] for the sibling
change from the same session.

## Prevention

- Treat a triage entry that lists only citation updates as **untriaged**. It has verified
  the cheap half.
- Distrust age plus a clean triage note. This item was ~2 weeks old, had been reviewed
  once, and read as ready.
- A premise most likely to be dead is one whose parent spec says it "routes around" the
  problem — that phrasing means the spec built its own path, which is exactly the
  condition that obsoletes the follow-on.

## Related Files

- `client/hooks/useNutritionLookup.ts` — the docblock on `servingSizeGrams`' initialiser
  records the resulting decision at the point of use
- `client/components/nutrition/nutrition-band-source.ts` — `selectBandSource`'s saved-item
  branch; the module that silently satisfied the premise
- `todos/archive/P3-2026-08-15-should-saved-item-path-populate-servingsizegrams.md` — the
  decision record and full consumer table

## See Also

- [A "metrics are stable" justification that was verified for only one of the cited metrics](multi-metric-stability-claim-checked-for-one-metric-2026-07-16.md) — the adjacent failure: a *plural* claim where only one member was checked. This one is a claim of a different *class* going unchecked entirely.
- [A null-input guard hoisted to the top of a function kills the branch that legitimately survives that null](../conventions/null-guard-hoisted-above-the-branch-that-survives-the-null-2026-08-15.md) — the guard-placement rule from the fix this follow-on hung off.
- [When a doc misleads, correct or bound the misleading sentence in place](../conventions/correct-the-sentence-that-taught-the-wrong-belief-2026-08-13.md) — why the stale premise was corrected in the parent todo rather than only noted in a new file.
