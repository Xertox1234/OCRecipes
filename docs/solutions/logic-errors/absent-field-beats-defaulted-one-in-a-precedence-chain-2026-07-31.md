---
title: "In a precedence chain, an ABSENT field is safer than a defaulted one — a confident default short-circuits the fallback that would have been right"
track: bug
category: logic-errors
tags: [api-contract, boundary-narrowing, defaults, precedence, nutrition, open-food-facts, three-state, wire-format]
module: shared
applies_to: ["server/routes/**/*.ts", "shared/lib/**/*.ts", "client/hooks/**/*.ts"]
symptoms: ["A downstream resolver has a sensible fallback that never runs", "A boolean field is always present and always plausible, but wrong for a whole class of inputs", "A helper returns false for an EMPTY collection and that false is forwarded as a real answer", "Adding a field made behaviour worse than omitting it"]
severity: medium
created: 2026-07-31
---

# In a precedence chain, an ABSENT field is safer than a defaulted one

## Problem

A consumer resolves a value through an ordered chain: an explicit flag wins, else a
heuristic, else give up. The producer emits the flag unconditionally. Because the flag is
always present, **the heuristic is unreachable** — and for every input where the producer had
no real information, it emits a confidently wrong answer that overrides a fallback which
would have been correct.

## Symptoms

- A carefully written fallback arm has no test that reaches it in production shape.
- The bug appears only for a whole *class* of inputs (a data source, a tier, a region) rather
  than for one record.
- `grep` shows the fallback exists and looks right; the defect is that nothing reaches it.
- Removing the field entirely would fix the behaviour — the tell that it is a *defaulting*
  bug, not a computation bug.

## Root Cause

Two independently reasonable decisions compose into a defect:

1. A classification helper returns `false` for an **empty** input. Correct in isolation:
   `isBeverageCategory([])` genuinely cannot see a beverage.
2. The call site forwards that `false` as though it were an observation.

The join is where the meaning is lost. `false` now conflates *"we checked and it is not X"*
with *"we had nothing to check"* — and the wire format has no way to say the second.

In the incident behind this rule, `server/routes/nutrition.ts` shipped
`isBeverage: isBeverageCategory(result.categoriesTags ?? [])`. The `?? []` guard never fired,
because `extractOffUniversalData(null)` (`server/services/barcode-lookup.ts`) returns
`categoriesTags: []` — its own docblock says "Both tag arrays default to `[]` for a
null/absent product". So **every USDA-only barcode with no Open Food Facts entry** shipped
`isBeverage: false`.

Downstream, `resolveBasis` reads:

```ts
const scale =
  input.isBeverage === true  ? "drink"
: input.isBeverage === false ? "food"
: parsed ? (parsed.unit === "ml" ? "drink" : "food") : null;   // ← unreachable
```

A real drink with a parseable `"1 can (355 mL)"` — which the unit fallback resolves correctly
to `drink` — was forced onto the food scale instead. Food nutrient thresholds are roughly
double drink thresholds, so it received **half the strictness**.

## Solution

Gate at the producer, on *evidence* rather than on the helper's return:

```ts
// BEFORE — `?? []` never fires; [] is the real shape, and it yields a confident `false`
const isBeverage = isBeverageCategory(result.categoriesTags ?? []);

// AFTER — no evidence means no claim. res.json() omits `undefined` keys.
const isBeverage =
  result.categoriesTags && result.categoriesTags.length > 0
    ? isBeverageCategory(result.categoriesTags)
    : undefined;
```

Leave the helper alone — its `[] → false` behaviour is correct for what it is asked. The
ambiguity has to be resolved at the call site that knows whether there was anything to look at.

Narrow at the consuming boundary so a missing key and a junk value land in the same "no
signal" state:

```ts
setIsBeverage(typeof data.isBeverage === "boolean" ? data.isBeverage : null);
```

Assert **absence**, not undefined-ness:

```ts
expect(res.body).not.toHaveProperty("isBeverage");   // ✅ distinguishes omitted from null
expect(res.body.isBeverage).toBeUndefined();          // ❌ also passes for a present `null`
```

## Prevention

- When adding a field to a payload, ask: **is there an input for which I have no information?**
  If yes, the type is `T | undefined`, not `T`. A three-valued domain cannot be modelled by a
  boolean, and the missing state is always the one that costs you.
- **Test the encoding production actually emits.** The original suite tested the key being
  entirely *omitted from the mock* — an input the real path cannot produce. The realistic "no
  data" shape, `categoriesTags: []`, was untested. That is why self-review missed it.
- Keep one test that proves the field still emits its *negative* value for genuine negatives
  (`["en:snacks"] → false`). Without it, "gate the default" and "stop emitting the field" look
  identical to the suite.
- When you write a precedence chain, write the test that reaches its **last** arm first. If
  you cannot construct an input that gets there, either the arm is dead or an upstream
  producer is over-claiming.

## Related Files

- `server/routes/nutrition.ts` — the derived `isBeverage`, gated on `categoriesTags.length > 0`
- `server/services/barcode-lookup.ts` — `extractOffUniversalData`, whose null branch yields `[]`
- `shared/lib/nutrition-bands.ts` — `resolveBasis`, the precedence chain whose fallback was starved
- `client/hooks/useNutritionLookup.ts` — the `typeof === "boolean"` boundary narrowing

## See Also

- [truthiness-guard-deletion-drops-unanalyzed-falsy-cases](truthiness-guard-deletion-drops-unanalyzed-falsy-cases-2026-07-30.md) — the sibling failure where a falsy value is silently reinterpreted
- [../conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md](../conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md) — why the test that would have caught this had to come from outside the same source
