---
title: "A value promoted into a new role does not inherit the invariant that guards that role"
track: bug
category: logic-errors
tags: [client-state, react, stale-state, hooks, health-claims, reset]
module: client
applies_to: ["client/hooks/**/*.ts", "client/components/nutrition/**/*.ts"]
symptoms: ["A screen re-fetched in place shows the previous subject's data in one widget", "A per-fetch reset block covers most state but not the field that was recently repurposed", "A 'has data?' guard passes on stale data because stale data has real values in it", "Only the failure paths are wrong — the success path overwrites the field and looks fine", "Never reproduces on a cold open, because there is no prior value to inherit"]
severity: medium
created: 2026-08-05
---

# A value promoted into a new role does not inherit the invariant that guards that role

## Problem

`fetchBarcodeData` opens with a deliberate stale-state reset, whose own comments
describe it as *"fail-safe by construction: any future early exit is correct by
default"* — `flags`, `conflict`, `labelReadNotice`, `labelUsed`, `dbSnapshot`,
`activeSource`, `isBeverage`.

`validatedData` was not in it, and did not need to be: it backed the serving
controls, which have their own gates. Slice 2c then promoted it into
`selectBandSource` — it became a **band source**, feeding the FSA traffic lights,
the pills and the standout copy.

It is written only in the `serverRes.ok` branch. The 404 `notInDatabase` branch,
the OFF `status !== 1` branch and the outer catch all call `setNutrition(...)`
and return without touching it. On an in-screen re-fetch, the new product's
health claims are computed from the **previous product's** per-100g values.

## Symptoms

- Wrong bands/pills on a product fetched into an existing screen instance, never
  on a cold open (there is no prior value to inherit)
- The failure paths misbehave and the success path looks perfect
- A presence check (`hasValue`) does not catch it — a stale source carries real
  numbers and is indistinguishable from a fresh one by shape

## Root Cause

The reset block is an invariant attached to a **role**: "everything that
describes the current product is cleared before we start describing a new one."
Membership was decided when each field acquired that role.

Promoting a field into the role is a change of meaning that happens somewhere
else entirely — in `selectBandSource`, a different file — so nothing at the
reset site prompts anyone to revisit it. The field's *declaration* did not
change, its *consumers* did.

This is worse than a missing field in a fresh-state initialiser, because the
result is not absence but a confident wrong answer: a health claim about the
wrong product.

## Solution

Add it to the same block, and record the promotion as the reason so the next
reader sees why a serving-control field is in a reset justified by band safety:

```ts
// Reset for the same fail-safe reason, and newly load-bearing: slice 2c
// promoted `validatedData` from "backs the serving controls" to "is a band
// source" (`selectBandSource`) ... Every state `selectBandSource` reads
// belongs in this block.
setValidatedData(null);
```

Test it with the shape that actually reproduces: a first lookup that populates
the field (negative control — assert it is non-null), then a re-fetch on a path
that never writes it (404 `notInDatabase`), asserting null.

## Prevention

- When you give an existing value a new consumer, check every invariant that
  guards the new consumer's category — the value did not carry those with it.
- State the reset block's membership rule as a predicate over roles ("everything
  `selectBandSource` reads"), not as a list. A list cannot be checked; a
  predicate can.
- Reach for the failure paths first. A field written only on the success path is
  exactly the one every other exit will inherit stale.
- Presence checks are not freshness checks. If `hasValue` is your only guard,
  stale data passes it by construction.

## Related Files

- `client/hooks/useNutritionLookup.ts` — `fetchBarcodeData`'s reset block
- `client/components/nutrition/nutrition-band-source.ts` — `selectBandSource`, the promotion that changed the field's role
- `client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx` — the consecutive-lookup regression test

## See Also

- [qualifier inside a surface that can render nothing](qualifier-inside-a-surface-that-can-render-nothing-2026-08-05.md) — sibling defect in the same slice: a responsibility moved and its protection stayed behind
- [absent field beats a defaulted one in a precedence chain](absent-field-beats-defaulted-one-in-a-precedence-chain-2026-07-31.md) — why a confident wrong value outranks a missing one in the bad direction
- [module-level mutable state persists stale state](../code-quality/module-level-mutable-state-react-smell-2026-05-13.md) — the same failure from a different storage location
